import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { UserError } from "@/lib/checks";
import { loadTrack } from "@/lib/terms";

export type StartProgress = {
  hasApps: boolean;
  /** First-run step: 0 add your app, 1 pick countries, 2 add keywords; null when done */
  step: number | null;
};

/** Whether any app is saved, and how far the first-run steps got for your own apps (removed ones excluded). */
export async function getStartProgress(): Promise<StartProgress> {
  "use cache";
  cacheLife("max");
  cacheTag("apps");
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
        exists (
          select 1 from apps where is_mine and added_at is not null
        ) as has_mine,
        exists (
          select 1 from apps
          where is_mine and added_at is not null and cardinality(countries) > 0
        ) as has_countries,
        exists (
          select 1 from terms t join apps a on a.track_id = t.app_id
          where a.is_mine and a.added_at is not null and t.deleted_at is null
        ) as has_keywords`);
    r = rows[0];
  } catch (e) {
    // TODO(release step 5): drop once the redesign schema is pushed (apps.countries, terms)
    if (!isMissingSchema(e)) throw e;
    const { rows } = await db.execute<typeof r>(sql`
      select
        exists (select 1 from apps) as has_apps,
        exists (
          select 1 from apps where is_mine and added_at is not null
        ) as has_mine,
        true as has_countries,
        false as has_keywords`);
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

type HomeApp = { trackId: number; name: string; icon: string };

export type HomeWord = {
  termId: number;
  phrase: string;
  volume: number;
  difficulty: number | null;
  rank: number | null;
};

/** The one thing to do next, for someone who does not know the app yet. */
export type HomeStep =
  | { kind: "add-app" }
  | { kind: "countries"; app: HomeApp }
  | { kind: "keywords"; app: HomeApp }
  | { kind: "waiting"; app: HomeApp }
  | { kind: "try" | "push"; app: HomeApp; country: string; words: HomeWord[] }
  | { kind: "done"; app: HomeApp; country: string; top10: number };

const MAX_WORDS = 3;

/**
 * Your apps in the order you added them; the first one with work wins.
 * Order of work: countries, keywords, first check, words worth trying, words to push.
 */
export async function getHomeStep(): Promise<HomeStep> {
  "use cache";
  cacheLife("max");
  cacheTag("apps", "checks");
  const { rows } = await db.execute<{
    track_id: number | string;
    name: string;
    icon: string;
    countries: string[];
    has_keywords: boolean;
  }>(sql`
    select a.track_id, a.name, a.icon, a.countries,
      exists (
        select 1 from terms t
        where t.app_id = a.track_id and t.deleted_at is null
      ) as has_keywords
    from apps a
    where a.is_mine and a.added_at is not null
    order by a.created_at`);
  if (rows.length === 0) return { kind: "add-app" };

  let done: HomeStep | null = null;
  for (const r of rows) {
    const app = { trackId: Number(r.track_id), name: r.name, icon: r.icon };
    if (r.countries.length === 0) return { kind: "countries", app };
    if (!r.has_keywords) return { kind: "keywords", app };

    // Countries in the order you picked them; the first is the main market
    const tracks = (
      await Promise.all(
        r.countries.map((c) =>
          loadTrack(app.trackId, c).catch((e) => {
            if (e instanceof UserError) return null;
            throw e;
          }),
        ),
      )
    ).filter((t) => t !== null);
    const checked = tracks.some((t) => t.rows.some((row) => row.checkedAt));
    if (!checked) return { kind: "waiting", app };

    for (const kind of ["try", "push"] as const) {
      for (const t of tracks) {
        const words = t.rows
          .filter((row) => row.nextStep === kind && row.volume !== null)
          .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
          .slice(0, MAX_WORDS)
          .map((row) => ({
            termId: row.termId,
            phrase: row.phrase,
            volume: row.volume ?? 0,
            difficulty: row.difficulty,
            rank: row.rank,
          }));
        if (words.length > 0) {
          return { kind, app, country: t.country, words };
        }
      }
    }
    const main = tracks[0];
    if (!done && main) {
      done = { kind: "done", app, country: main.country, top10: main.top10 };
    }
  }
  return (
    done ?? {
      kind: "waiting",
      app: {
        trackId: Number(rows[0].track_id),
        name: rows[0].name,
        icon: rows[0].icon,
      },
    }
  );
}
