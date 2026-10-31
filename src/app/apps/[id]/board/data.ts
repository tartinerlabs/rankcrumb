import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { TermMode, TopApp } from "@/db/schema";
import { loadBoard } from "@/lib/terms";

const TOP_APPS = 5;

export type CellView = {
  /** null when the phrase was cleared on purpose */
  phrase: string | null;
  edited: boolean;
  /** Waiting in the check queue */
  queued: boolean;
  /** Has at least one check */
  checked: boolean;
  rank: number | null;
  volume: number | null;
  difficulty: number | null;
  /** Top apps of the latest check, with rating counts */
  top: TopApp[];
};

export type TermView = {
  id: number;
  label: string;
  mode: TermMode;
  hidden: boolean;
  group: "listing" | "ideas";
  /** Only storefronts with a phrase row */
  cells: Record<string, CellView>;
  top10: number;
  checked: number;
  avgVolume: number | null;
  avgDifficulty: number | null;
  /** Storefronts with a phrase */
  countries: number;
};

export type BoardView = { countries: string[]; terms: TermView[] };

/**
 * Top apps of each keyword's latest check, with rating counts (latestChecks
 * keeps only id, name and icon). Read-only.
 */
async function latestTopApps(keywordIds: number[]) {
  const top = new Map<number, TopApp[]>();
  const ids = [...new Set(keywordIds)];
  if (ids.length === 0) return top;
  const { rows } = await db.execute<{ keyword_id: number; top: TopApp[] }>(sql`
    select k.id as keyword_id,
      jsonb_path_query_array(c.top_apps, '$[0 to $last]',
        jsonb_build_object('last', ${TOP_APPS - 1}::int)) as top
    from keywords k
    join lateral (
      select top_apps from keyword_checks
      where keyword_id = k.id order by checked_at desc limit 1
    ) c on true
    where k.id in ${ids}`);
  for (const r of rows) top.set(r.keyword_id, r.top);
  return top;
}

/** The app's terms with every storefront cell, ready for the Board and Keywords tabs. */
export async function loadBoardView(
  appId: number,
  opts: { withTopApps?: boolean } = {},
): Promise<BoardView> {
  const board = await loadBoard(appId);
  const top = opts.withTopApps
    ? await latestTopApps(
        board.terms.flatMap((t) =>
          Object.values(t.cells).flatMap((c) =>
            c.keywordId !== null && c.latest ? [c.keywordId] : [],
          ),
        ),
      )
    : new Map<number, TopApp[]>();

  return {
    countries: board.countries,
    terms: board.terms.map((t) => ({
      id: t.id,
      label: t.label,
      mode: t.mode,
      hidden: t.hidden,
      group: t.group,
      top10: t.top10,
      checked: t.checked,
      avgVolume: t.avgVolume,
      avgDifficulty: t.avgDifficulty,
      countries: t.countries,
      cells: Object.fromEntries(
        Object.entries(t.cells).map(([country, c]) => [
          country,
          {
            phrase: c.phrase,
            edited: c.edited,
            queued: c.queued,
            checked: c.latest !== null,
            rank: c.latest?.rank ?? null,
            volume: c.latest?.volume ?? null,
            difficulty: c.latest?.difficulty ?? null,
            top: (c.keywordId !== null && top.get(c.keywordId)) || [],
          },
        ]),
      ),
    })),
  };
}
