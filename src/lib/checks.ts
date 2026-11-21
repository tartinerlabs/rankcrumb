import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  apps,
  keywordChecks,
  keywords,
  type TopApp,
  termPhrases,
} from "@/db/schema";
import { search, searchHints } from "@/lib/itunes";
import { enqueue } from "@/lib/queue";
import {
  difficultyScore,
  normalize,
  popularityScore,
  rankOf,
  volumeScore,
} from "@/lib/scoring";

const MAX_PHRASE_LENGTH = 100;
// Autocomplete gets one overall limit, well inside the worker's 60s lease
const POPULARITY_BUDGET_MS = 15_000;
// Room left after autocomplete before the caller's deadline, as the worker's stop margin
const POPULARITY_DEADLINE_MARGIN_MS = 15_000;
const HOUR_MS = 3_600_000;

/** A failure the user should see as is (bad input, missing app). */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** A phrase in one storefront. */
export type Pair = { country: string; phrase: string };
export type AppRow = typeof apps.$inferSelect;

/**
 * Demand from App Store autocomplete: the fewest characters of the phrase typed
 * before Apple suggests it, by binary search after one full-phrase request
 * (about 5 requests). Null when the storefront has no id, Apple fails, or the
 * requests outlast one overall limit (15s, less near the caller's deadline).
 */
async function popularity(
  phrase: string,
  country: string,
  deadline?: number,
): Promise<number | null> {
  const budget = Math.min(
    POPULARITY_BUDGET_MS,
    deadline === undefined
      ? POPULARITY_BUDGET_MS
      : deadline - Date.now() - POPULARITY_DEADLINE_MARGIN_MS,
  );
  if (budget <= 0) return null;
  const signal = AbortSignal.timeout(budget);
  // Spaces ignored: Apple suggests "kalorien zähler" for "kalorienzähler"
  const compact = (s: string) => normalize(s).replaceAll(" ", "");
  const target = compact(phrase);
  const chars = Array.from(phrase);
  // 1-based place of the phrase among the suggestions, 0 when absent, null when unknown storefront
  const placeAt = async (typed: number) => {
    const hints = await searchHints(
      chars.slice(0, typed).join(""),
      country,
      signal,
    );
    if (hints === null) return null;
    const i = hints.findIndex((h) => compact(h) === target);
    return i + 1;
  };
  try {
    const full = await placeAt(chars.length);
    if (full === null) return null;
    if (full === 0) return popularityScore(null);
    // Smallest prefix that still suggests the phrase; suggestions keep it once it shows
    let lo = 1;
    let hi = chars.length;
    let position = full;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const at = await placeAt(mid);
      if (at) {
        hi = mid;
        position = at;
      } else {
        lo = mid + 1;
      }
    }
    return popularityScore({ typed: hi, position });
  } catch (e) {
    console.warn(`popularity ${country} "${phrase}"`, e);
    return null;
  }
}

/** Search Apple once and read its autocomplete alongside, score both, then save the keyword and a new check. */
export async function recordCheck(
  phrase: string,
  country: string,
  appId: number | null,
  opts?: { deadline?: number },
) {
  // Autocomplete is another Apple host and never throws, so it runs during the gate wait
  const [topApps, demand] = await Promise.all([
    search(phrase, country, opts),
    popularity(phrase, country, opts?.deadline),
  ]);
  // Old title-targeting score, still stored in the volume column; Demand reads popularity
  const volume = volumeScore(phrase, topApps);
  const difficulty = difficultyScore(phrase, topApps);
  const rank = appId === null ? null : rankOf(topApps, appId);

  const [{ id: keywordId }] = await db
    .insert(keywords)
    // No-op update so RETURNING gives the id of an existing row too
    .values({ phrase, country })
    .onConflictDoUpdate({
      target: [keywords.country, keywords.phrase],
      set: { phrase: sql`excluded.phrase` },
    })
    .returning({ id: keywords.id });

  const [inserted] = await db
    .insert(keywordChecks)
    .values({
      keywordId,
      volume,
      popularity: demand,
      difficulty,
      topApps,
      appId,
      rank,
    })
    .returning({ id: keywordChecks.id, checkedAt: keywordChecks.checkedAt });

  return {
    checkId: inserted.id,
    keywordId,
    popularity: demand,
    difficulty,
    topApps,
    rank,
    checkedAt: inserted.checkedAt,
  };
}

const appIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** A saved app; workspaces only (added_at set) unless `any`, own apps only with `mine`. */
export async function appRow(
  appId: number,
  opts: { mine?: boolean; any?: boolean } = {},
): Promise<AppRow> {
  if (!appIdSchema.safeParse(appId).success) {
    throw new UserError("App not found");
  }
  const [app] = await db.select().from(apps).where(eq(apps.trackId, appId));
  if (!app || (!opts.any && app.addedAt === null)) {
    throw new UserError("App not found");
  }
  if (opts.mine && !app.isMine) {
    throw new UserError("This is not one of your apps");
  }
  return app;
}

const pairSchema = z.object({
  country: z.string().regex(/^[a-z]{2}$/, "Storefront codes are two letters"),
  phrase: z
    .string()
    .min(1, "Keywords cannot be empty")
    .max(
      MAX_PHRASE_LENGTH,
      `Keep keywords under ${MAX_PHRASE_LENGTH} characters`,
    ),
});

/** Upsert keyword rows; id per `${country}:${phrase}`. Phrases must already be normalised. */
export async function upsertKeywords(
  pairs: Pair[],
): Promise<Map<string, number>> {
  const parsed = z.array(pairSchema).safeParse(pairs);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const ids = new Map<string, number>();
  // One per storefront and phrase; a second insert of the same row would fail
  const unique = [
    ...new Map(
      parsed.data.map((p) => [`${p.country}:${p.phrase}`, p]),
    ).values(),
  ];
  if (unique.length === 0) return ids;

  const rows = await db
    .insert(keywords)
    .values(unique.map(({ country, phrase }) => ({ country, phrase })))
    // No-op update so RETURNING gives the ids of existing rows too
    .onConflictDoUpdate({
      target: [keywords.country, keywords.phrase],
      set: { phrase: sql`excluded.phrase` },
    })
    .returning({
      id: keywords.id,
      country: keywords.country,
      phrase: keywords.phrase,
    });
  for (const r of rows) ids.set(`${r.country}:${r.phrase}`, r.id);
  return ids;
}

export type AppRef = Pick<TopApp, "id" | "name" | "icon">;

export type Latest = {
  checkedAt: Date;
  /** Demand: the popularity column (App Store autocomplete); null when not measured */
  volume: number | null;
  difficulty: number;
  /** Rank of the requested app; null when it is not in the top 200 or no app was asked */
  rank: number | null;
  /** Rank in the check before; undefined when there is no earlier check */
  previousRank: number | null | undefined;
  top: AppRef[];
};

/**
 * Latest check per keyword, for Board, Track, competitors and brainstorms.
 * rank and previousRank are for appId, computed in SQL; top is the first topN apps.
 */
export async function latestChecks(
  keywordIds: number[],
  opts: { appId?: number; topN?: number } = {},
): Promise<Map<number, Latest>> {
  const parsed = z
    .object({
      keywordIds: z.array(z.number().int().positive()),
      appId: appIdSchema.optional(),
      topN: z.number().int().min(1).max(200).default(10),
    })
    .safeParse({ keywordIds, ...opts });
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const { appId, topN } = parsed.data;
  const ids = [...new Set(parsed.data.keywordIds)];
  const latest = new Map<number, Latest>();
  if (ids.length === 0) return latest;

  // Rank as the 1-based position of appId in the stored results
  const rankIn = (alias: string) =>
    appId === undefined
      ? sql`null::int`
      : sql`(select r.i from jsonb_array_elements(${sql.raw(alias)}.top_apps) with ordinality r(app, i)
          where (r.app->>'id')::bigint = ${appId}::bigint limit 1)::int`;

  const { rows } = await db.execute<{
    keyword_id: number;
    // Raw timestamptz text from db.execute
    checked_at: string;
    volume: number | null;
    difficulty: number;
    rank: number | null;
    has_previous: boolean;
    previous_rank: number | null;
    top: AppRef[];
  }>(sql`
    select k.id as keyword_id, c.checked_at, c.popularity as volume, c.difficulty,
      ${rankIn("c")} as rank,
      p.top_apps is not null as has_previous,
      ${rankIn("p")} as previous_rank,
      jsonb_path_query_array(c.top_apps, '$[0 to $last]',
        jsonb_build_object('last', ${topN - 1}::int)) as top
    from keywords k
    join lateral (
      select checked_at, popularity, difficulty, top_apps from keyword_checks
      where keyword_id = k.id order by checked_at desc limit 1
    ) c on true
    left join lateral (
      select top_apps from keyword_checks
      where keyword_id = k.id order by checked_at desc offset 1 limit 1
    ) p on true
    where k.id in ${ids}`);

  for (const r of rows) {
    latest.set(r.keyword_id, {
      checkedAt: new Date(r.checked_at),
      volume: r.volume,
      difficulty: r.difficulty,
      rank: r.rank,
      previousRank: r.has_previous ? r.previous_rank : undefined,
      top: r.top.map(({ id, name, icon }) => ({ id, name, icon })),
    });
  }
  return latest;
}

/**
 * Upsert term phrases on (termId, country). edited:false never overwrites an
 * edited row or a null row (cleared on purpose) unless overwrite is set. Then
 * queue checks of the saved phrases older than 20 hours, ahead of scheduled ones.
 */
export async function savePhrases(
  rows: { termId: number; country: string; phrase: string; edited: boolean }[],
  opts: { overwrite?: boolean } = {},
): Promise<{ saved: number; queued: number }> {
  const parsed = z
    .array(
      pairSchema.extend({
        termId: z.number().int().positive(),
        edited: z.boolean(),
      }),
    )
    .safeParse(rows);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  // Last row wins per term and storefront; one statement cannot touch a row twice
  const unique = [
    ...new Map(
      parsed.data.map((r) => [`${r.termId}:${r.country}`, r]),
    ).values(),
  ];
  if (unique.length === 0) return { saved: 0, queued: 0 };

  const ids = await upsertKeywords(unique);
  const saved = await db
    .insert(termPhrases)
    .values(
      unique.map((r) => ({
        termId: r.termId,
        country: r.country,
        keywordId: ids.get(`${r.country}:${r.phrase}`) as number,
        edited: r.edited,
      })),
    )
    .onConflictDoUpdate({
      target: [termPhrases.termId, termPhrases.country],
      set: {
        keywordId: sql`excluded.keyword_id`,
        edited: sql`excluded.edited`,
        updatedAt: sql`now()`,
      },
      setWhere: opts.overwrite
        ? undefined
        : sql`excluded.edited or (not term_phrases.edited and term_phrases.keyword_id is not null)`,
    })
    .returning({ keywordId: termPhrases.keywordId });

  const queued = await enqueue(
    saved.flatMap((r) => (r.keywordId === null ? [] : [r.keywordId])),
    { maxAgeMs: 20 * HOUR_MS, priority: 0 },
  );
  return { saved: saved.length, queued };
}

/** Checks of history shown per keyword. */
export const HISTORY = 30;
