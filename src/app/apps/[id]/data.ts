import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { db } from "@/db";
import type { ListingText, Schedule } from "@/db/schema";

export type WorkspaceApp = {
  trackId: number;
  name: string;
  icon: string;
  isMine: boolean;
  storefront: string;
  language: string;
  schedule: Schedule;
  subtitle: string | null;
  /** Storefront codes shown in the country bar, in display order */
  countries: string[];
  /** Latest check of any of this app's keywords */
  lastCheckedAt: Date | null;
};

// Row as JSON, so columns the database does not have yet just come back missing
type AppJson = {
  track_id: number | string;
  name: string;
  icon: string;
  is_mine: boolean;
  storefront?: string;
  countries?: string[];
  language?: string;
  schedule?: Schedule;
  listing?: Record<string, ListingText> | null;
};

/** One app for its workspace, or null when the id is unknown. Deduped per request. */
export const getWorkspaceApp = cache(
  async (id: string): Promise<WorkspaceApp | null> => {
    await connection();
    if (!/^\d{1,15}$/.test(id)) return null;
    const trackId = Number(id);

    const { rows } = await db.execute<{ app: AppJson; has_terms: boolean }>(
      sql`
        select to_jsonb(a) as app,
          to_regclass('term_phrases') is not null as has_terms
        from apps a
        where a.track_id = ${trackId}`,
    );
    const row = rows[0];
    if (!row) return null;
    const app = row.app;

    // Keywords reach an app through app_keywords and, once terms exist, its terms' local phrases
    const keywordIds: SQL = row.has_terms
      ? sql`
          select ak.keyword_id from app_keywords ak where ak.app_id = ${trackId}
          union
          select tp.keyword_id
          from terms t
          join term_phrases tp on tp.term_id = t.id
          where t.app_id = ${trackId}
            and t.deleted_at is null
            and tp.keyword_id is not null`
      : sql`select ak.keyword_id from app_keywords ak where ak.app_id = ${trackId}`;

    const { rows: statRows } = await db.execute<{
      countries: string[] | null;
      last_checked_at: string | Date | null;
    }>(sql`
      with kw as (${keywordIds})
      select
        (
          select array_agg(distinct k.country order by k.country)
          from kw join keywords k on k.id = kw.keyword_id
        ) as countries,
        (
          select max(kc.checked_at)
          from keyword_checks kc
          where kc.keyword_id in (select keyword_id from kw)
        ) as last_checked_at`);
    const stats = statRows[0];

    const saved = app.countries ?? [];
    const tracked = stats?.countries ?? [];
    // Nothing saved or tracked stays empty: presets are offered, not shown as set
    const countries = saved.length > 0 ? saved : tracked;

    const language = app.language ?? "en-US";
    const listing = app.listing ?? {};
    const subtitle =
      listing[language]?.subtitle ||
      Object.values(listing).find((l) => l.subtitle)?.subtitle ||
      null;

    return {
      trackId: Number(app.track_id),
      name: app.name,
      icon: app.icon,
      isMine: app.is_mine,
      storefront: app.storefront ?? "us",
      language,
      schedule: app.schedule ?? "daily",
      subtitle,
      countries,
      lastCheckedAt: stats?.last_checked_at
        ? new Date(stats.last_checked_at)
        : null,
    };
  },
);
