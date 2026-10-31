import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";

export type SidebarApp = {
  trackId: number;
  name: string;
  icon: string;
  isMine: boolean;
  /** Tracked keywords whose latest check ranks the app in the top 10 */
  top10: number;
};

export type SidebarBrainstorm = { id: number; idea: string };

/** Workspace apps for the sidebar (added on the start screen): yours first, then the rest, oldest first. */
export async function getSidebarApps(): Promise<SidebarApp[]> {
  "use cache";
  cacheLife("max");
  cacheTag("apps", "checks");
  const { rows: probe } = await db.execute<{ has_terms: boolean }>(
    sql`select to_regclass('term_phrases') is not null as has_terms`,
  );
  // Same keyword set as the workspace and the queue: the terms' local phrases
  const keywordIds = probe[0]?.has_terms
    ? sql`
        select tp.keyword_id
        from terms t
        join term_phrases tp on tp.term_id = t.id
        where t.app_id = a.track_id
          and t.deleted_at is null
          and tp.keyword_id is not null`
    : sql`select null::integer as keyword_id where false`;

  const { rows } = await db.execute<{
    track_id: number | string;
    name: string;
    icon: string;
    is_mine: boolean;
    top10: number;
  }>(sql`
    select a.track_id, a.name, a.icon, a.is_mine,
      (
        select count(*)::int
        from (${keywordIds}) kw
        join lateral (
          select top_apps
          from keyword_checks
          where keyword_id = kw.keyword_id
          order by checked_at desc
          limit 1
        ) c on true
        where jsonb_path_exists(
          c.top_apps,
          '$[0 to 9] ? (@.id == $id)',
          jsonb_build_object('id', a.track_id)
        )
      ) as top10
    from apps a
    where a.added_at is not null
    order by a.is_mine desc, a.created_at`);

  return rows.map((r) => ({
    trackId: Number(r.track_id),
    name: r.name,
    icon: r.icon,
    isMine: r.is_mine,
    top10: r.top10,
  }));
}

/** Saved brainstorms for the sidebar, newest first. */
export async function getSidebarBrainstorms(): Promise<SidebarBrainstorm[]> {
  "use cache";
  cacheLife("max");
  cacheTag("brainstorms");
  const { rows } = await db.execute<{ id: number; idea: string }>(sql`
    select id, idea from brainstorms order by created_at desc, id desc`);
  return rows.map((r) => ({ id: Number(r.id), idea: r.idea }));
}
