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
import { search } from "@/lib/itunes";
import { enqueue } from "@/lib/queue";
import { difficultyScore, rankOf, volumeScore } from "@/lib/scoring";

const MAX_PHRASE_LENGTH = 100;
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

/** Search Apple once, score the results, then save the keyword and a new check. */
export async function recordCheck(
  phrase: string,
  country: string,
  appId: number | null,
  opts?: { deadline?: number },
) {
  const topApps = await search(phrase, country, opts);
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
    .values({ keywordId, volume, difficulty, topApps, appId, rank })
    .returning({ id: keywordChecks.id, checkedAt: keywordChecks.checkedAt });

  return {
    checkId: inserted.id,
    keywordId,
    volume,
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
  volume: number;
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
    volume: number;
    difficulty: number;
    rank: number | null;
    has_previous: boolean;
    previous_rank: number | null;
    top: AppRef[];
  }>(sql`
    select k.id as keyword_id, c.checked_at, c.volume, c.difficulty,
      ${rankIn("c")} as rank,
      p.top_apps is not null as has_previous,
      ${rankIn("p")} as previous_rank,
      jsonb_path_query_array(c.top_apps, '$[0 to $last]',
        jsonb_build_object('last', ${topN - 1}::int)) as top
    from keywords k
    join lateral (
      select checked_at, volume, difficulty, top_apps from keyword_checks
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
