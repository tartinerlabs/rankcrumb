import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TopApp } from "@/db/schema";
import { HISTORY, UserError } from "@/lib/checks";
import { loadHistory } from "@/lib/terms";

const TOP_APPS = 5;

export type DetailCheck = {
  checkedAt: string;
  rank: number | null;
  volume: number;
  difficulty: number;
  top: TopApp[];
};

export type KeywordDetail = {
  label: string;
  /** One per storefront with a phrase, in display order; checks newest first */
  series: { country: string; phrase: string; checks: DetailCheck[] }[];
};

/** Rank history per storefront plus each check's top apps, or null for an unknown term. */
export async function loadKeywordDetail(
  appId: number,
  termId: number,
): Promise<KeywordDetail | null> {
  let history: Awaited<ReturnType<typeof loadHistory>>;
  try {
    // Also checks the term belongs to the app
    history = await loadHistory(appId, termId);
  } catch (e) {
    if (e instanceof UserError) return null;
    throw e;
  }

  // Same checks as loadHistory, read for their top apps with rating counts
  const { rows } = await db.execute<{
    country: string;
    // Raw timestamptz text from db.execute
    checked_at: string;
    top: TopApp[];
  }>(sql`
    select tp.country, c.checked_at, c.top
    from term_phrases tp
    join keywords k on k.id = tp.keyword_id
    join lateral (
      select checked_at,
        jsonb_path_query_array(top_apps, '$[0 to $last]',
          jsonb_build_object('last', ${TOP_APPS - 1}::int)) as top
      from keyword_checks
      where keyword_id = k.id
      order by checked_at desc
      limit ${HISTORY}
    ) c on true
    where tp.term_id = ${termId}`);
  const tops = new Map(
    rows.map((r) => [
      `${r.country}|${new Date(r.checked_at).toISOString()}`,
      r.top,
    ]),
  );

  return {
    label: history.label,
    series: history.series.map((s) => ({
      country: s.country,
      phrase: s.phrase,
      checks: s.points
        .map((p) => ({
          ...p,
          top: tops.get(`${s.country}|${p.checkedAt}`) ?? [],
        }))
        .reverse(),
    })),
  };
}
