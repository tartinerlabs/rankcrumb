import "server-only";

import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";

export type StartProgress = {
  hasApps: boolean;
  /** First-run step: 0 add your app, 1 pick countries, 2 add keywords; null when done */
  step: number | null;
};

/** Whether any app is saved, and how far the first-run steps got for your own apps. */
export async function getStartProgress(): Promise<StartProgress> {
  await connection();
  let r: {
    has_apps: boolean;
    has_mine: boolean;
    has_countries: boolean;
    has_keywords: boolean;
  };
  try {
    const { rows } = await db.execute<typeof r>(sql`
      select
        exists (select 1 from apps) as has_apps,
        exists (select 1 from apps where is_mine) as has_mine,
        exists (
          select 1 from apps where is_mine and cardinality(countries) > 0
        ) as has_countries,
        exists (
          select 1 from terms t join apps a on a.track_id = t.app_id
          where a.is_mine and t.deleted_at is null
        ) or exists (
          select 1 from app_keywords ak join apps a on a.track_id = ak.app_id
          where a.is_mine
        ) as has_keywords`);
    r = rows[0];
  } catch (e) {
    // TODO(release step 5): drop once the redesign schema is pushed (apps.countries, terms)
    if (!isMissingSchema(e)) throw e;
    const { rows } = await db.execute<typeof r>(sql`
      select
        exists (select 1 from apps) as has_apps,
        exists (select 1 from apps where is_mine) as has_mine,
        true as has_countries,
        exists (
          select 1 from app_keywords ak join apps a on a.track_id = ak.app_id
          where a.is_mine
        ) as has_keywords`);
    r = rows[0];
  }

  const step = !r.has_mine
    ? 0
    : !r.has_countries
      ? 1
      : !r.has_keywords
        ? 2
        : null;
  return { hasApps: r.has_apps, step };
}

/** Postgres undefined_table or undefined_column. */
function isMissingSchema(e: unknown): boolean {
  const code =
    (e as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (e as { code?: string })?.code;
  return code === "42P01" || code === "42703";
}
