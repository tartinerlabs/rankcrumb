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
import { APPLE_GAP_MS } from "@/lib/gate";
import { InvalidStorefrontError, search, ThrottledError } from "@/lib/itunes";
import { enqueue } from "@/lib/queue";
import { difficultyScore, normalize, rankOf, volumeScore } from "@/lib/scoring";

// Gap between Apple requests, to stay under their rate limit
export { APPLE_GAP_MS };
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Phrases split on newlines or commas, normalised and deduplicated. */
export const phrasesField = z
  .string()
  .transform((s) => [
    ...new Set(s.split(/[\n,]/).map(normalize).filter(Boolean)),
  ])
  .pipe(
    z
      .array(
        z
          .string()
          .max(
            MAX_PHRASE_LENGTH,
            `Keep keywords under ${MAX_PHRASE_LENGTH} characters`,
          ),
      )
      .min(1, "Enter at least one keyword"),
  );

/** Storefront codes split on spaces or commas, lowercased and deduplicated. */
export const countriesField = z
  .string()
  .transform((s) => [
    ...new Set(
      s
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean),
    ),
  ])
  .pipe(
    z
      .array(z.string().regex(/^[a-z]{2}$/, "Storefront codes are two letters"))
      .min(1, "Enter at least one storefront"),
  );

/** Explicit storefront and phrase pairs, normalised; deduplicate before use. */
export const pairsField = z.array(
  z.object({
    country: z.string().regex(/^[a-z]{2}$/, "Storefront codes are two letters"),
    phrase: z
      .string()
      .transform(normalize)
      .pipe(
        z
          .string()
          .min(1, "Keywords cannot be empty")
          .max(
            MAX_PHRASE_LENGTH,
            `Keep keywords under ${MAX_PHRASE_LENGTH} characters`,
          ),
      ),
  }),
);

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
 * edited row or a null row (cleared on purpose). Then queue checks of the saved
 * phrases older than 20 hours, ahead of scheduled ones.
 */
export async function savePhrases(
  rows: { termId: number; country: string; phrase: string; edited: boolean }[],
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
      setWhere: sql`excluded.edited or (not term_phrases.edited and term_phrases.keyword_id is not null)`,
    })
    .returning({ keywordId: termPhrases.keywordId });

  const queued = await enqueue(
    saved.flatMap((r) => (r.keywordId === null ? [] : [r.keywordId])),
    { maxAgeMs: 20 * HOUR_MS, priority: 0 },
  );
  return { saved: saved.length, queued };
}

/**
 * Check tracked keywords with no check in the last 20 hours, stalest first,
 * one at a time with a gap between Apple requests. Stops at the limit, at the
 * deadline or when Apple throttles; the next run picks up the rest.
 * Pass appId to refresh only that app's keywords.
 */
export async function refreshTracked({
  appId,
  limit,
  deadline,
}: {
  appId?: number;
  limit: number;
  deadline: number;
}) {
  const { rows } = await db.execute<{
    phrase: string;
    country: string;
    my_app: string | null;
  }>(sql`
    select k.phrase, k.country,
      ${
        appId === undefined
          ? sql`(select min(a.track_id) from app_keywords ak
              join apps a on a.track_id = ak.app_id
              where ak.keyword_id = k.id and a.is_mine)`
          : sql`${appId}::bigint`
      } as my_app
    from keywords k
    where exists (
        select 1 from app_keywords ak where ak.keyword_id = k.id
        ${appId === undefined ? sql`` : sql`and ak.app_id = ${appId}`}
      )
      and not exists (
        select 1 from keyword_checks c
        where c.keyword_id = k.id and c.checked_at > now() - interval '20 hours'
      )
    order by (select max(c.checked_at) from keyword_checks c where c.keyword_id = k.id) asc nulls first
    limit ${limit + 1}`);
  // One extra row tells whether more are due than this run takes
  const more = rows.length > limit;
  const due = rows.slice(0, limit);

  let checked = 0;
  let failed = 0;
  let throttled = false;
  let lastRequestAt = 0;

  for (const { phrase, country, my_app } of due) {
    if (Date.now() + APPLE_GAP_MS > deadline) break;
    const wait = lastRequestAt + APPLE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      await recordCheck(
        phrase,
        country,
        my_app === null ? null : Number(my_app),
      );
      checked++;
    } catch (e) {
      if (e instanceof ThrottledError) {
        throttled = true;
        break;
      }
      failed++;
      if (
        !(e instanceof InvalidStorefrontError) &&
        !(e instanceof DOMException && e.name === "TimeoutError")
      ) {
        console.error(`refreshTracked ${country} "${phrase}"`, e);
      }
    }
  }

  return { due: due.length, checked, failed, throttled, more };
}

/** Checks of history kept per tracked keyword. */
export const HISTORY = 30;

export type Check = {
  checkedAt: Date;
  volume: number;
  difficulty: number;
  /** Result IDs in rank order */
  results: { id: number }[];
};

export type Tracked = {
  keywordId: number;
  /** Groups local phrases of one keyword across storefronts */
  label: string;
  phrase: string;
  country: string;
  /** Newest first */
  checks: Check[];
};

/** Tracked keywords of an app with their last checks, newest first. */
export async function loadTracked(appId: number): Promise<Tracked[]> {
  // Last 30 checks per tracked keyword; only result IDs, not the full lists
  const { rows } = await db.execute<{
    keyword_id: number;
    label: string;
    phrase: string;
    country: string;
    // Raw timestamptz text from db.execute
    checked_at: string | null;
    volume: number | null;
    difficulty: number | null;
    ids: number[] | null;
  }>(sql`
    select k.id as keyword_id, coalesce(ak.label, k.phrase) as label,
      k.phrase, k.country,
      c.checked_at, c.volume, c.difficulty, c.ids
    from app_keywords ak
    join keywords k on k.id = ak.keyword_id
    left join lateral (
      select checked_at, volume, difficulty,
        jsonb_path_query_array(top_apps, '$[*].id') as ids
      from keyword_checks
      where keyword_id = k.id
      order by checked_at desc
      limit ${HISTORY}
    ) c on true
    where ak.app_id = ${appId}
    order by label, k.country, c.checked_at desc`);

  const byKeyword = new Map<number, Tracked>();
  for (const r of rows) {
    let t = byKeyword.get(r.keyword_id);
    if (!t) {
      t = {
        keywordId: r.keyword_id,
        label: r.label,
        phrase: r.phrase,
        country: r.country,
        checks: [],
      };
      byKeyword.set(r.keyword_id, t);
    }
    if (r.checked_at && r.ids) {
      t.checks.push({
        checkedAt: new Date(r.checked_at),
        volume: r.volume ?? 0,
        difficulty: r.difficulty ?? 0,
        results: r.ids.map((id) => ({ id })),
      });
    }
  }
  return [...byKeyword.values()];
}
