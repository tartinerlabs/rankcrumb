import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  appCompetitors,
  appKeywords,
  apps,
  type Schedule,
  terms,
} from "@/db/schema";
import { STOREFRONT_LOCALES } from "@/lib/asc";
import { type AppRef, appRow, UserError } from "@/lib/checks";
import {
  type AppInfo,
  findApps,
  lookup,
  parseAppLink,
  ThrottledError,
} from "@/lib/itunes";
import { cacheListing } from "@/lib/meta";

export type AppHit = AppInfo & {
  saved: { isMine: boolean; workspace: boolean } | null;
};

export type AppSummary = {
  id: number;
  name: string;
  icon: string;
  developer: string;
  isMine: boolean;
  storefront: string;
  countries: string[];
  language: string;
  schedule: Schedule;
  /** Terms that are not deleted, hidden included */
  terms: number;
  competitors: AppRef[];
};

/** Storefronts offered to a new own app. */
export const DEFAULT_COUNTRIES = ["us", "gb", "ca", "au", "de"];

// A name search tries more storefronts while it has fewer hits than this
const MIN_HITS = 5;
const EXTRA_STOREFRONTS = 2;

const appId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const country = z
  .string()
  .regex(/^[a-z]{2}$/, "Storefront codes are two letters");

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  return parsed.data;
}

/**
 * A link or id → 1 lookup. A name → search in the US, then in the 2 storefronts
 * most used by workspaces while there are fewer than 5 hits. At most 3 calls,
 * deduplicated by id. Saved flags come from the DB.
 */
export async function searchApps(query: string): Promise<AppHit[]> {
  const q = parse(
    z.string().trim().min(1, "Enter an app name or link").max(200),
    query,
  );

  let found: AppInfo[];
  const link = parseAppLink(q);
  if (link) {
    const app = await lookup(link.id, link.country);
    found = app ? [app] : [];
  } else {
    found = await findApps(q, "us");
    if (found.length < MIN_HITS) {
      const { rows } = await db.execute<{ country: string }>(sql`
        select c as country from apps, unnest(countries) c
        where added_at is not null and c <> 'us'
        group by c order by count(*) desc, c
        limit ${EXTRA_STOREFRONTS}`);
      for (const { country } of rows) {
        if (found.length >= MIN_HITS) break;
        try {
          const more = await findApps(q, country);
          const seen = new Set(found.map((a) => a.id));
          found.push(...more.filter((a) => !seen.has(a.id)));
        } catch (e) {
          // Keep the US hits when a later storefront is throttled
          if (e instanceof ThrottledError) break;
          throw e;
        }
      }
    }
  }
  if (found.length === 0) return [];

  const saved = await db
    .select({
      trackId: apps.trackId,
      isMine: apps.isMine,
      addedAt: apps.addedAt,
    })
    .from(apps)
    .where(
      inArray(
        apps.trackId,
        found.map((a) => a.id),
      ),
    );
  const byId = new Map(saved.map((s) => [s.trackId, s]));
  return found.map((a) => {
    const s = byId.get(a.id);
    return {
      ...a,
      saved: s ? { isMine: s.isMine, workspace: s.addedAt !== null } : null,
    };
  });
}

/**
 * Look up (unless saved), then make the app a workspace. A competitor workspace
 * gets the storefront it was found in when it has none; an own app gets its
 * listing cached. needsCountries is true for an own app with no countries.
 */
export async function addApp(input: {
  id: number;
  country: string;
  mine: boolean;
}): Promise<{ app: AppSummary; needsCountries: boolean }> {
  const {
    id,
    country: cc,
    mine,
  } = parse(z.object({ id: appId, country, mine: z.boolean() }), input);

  const [existing] = await db
    .select({ name: apps.name, icon: apps.icon, developer: apps.developer })
    .from(apps)
    .where(eq(apps.trackId, id));
  const info = existing ?? (await lookup(id, cc));
  if (!info) throw new UserError("App not found in that storefront");

  await db
    .insert(apps)
    .values({
      trackId: id,
      name: info.name,
      icon: info.icon,
      developer: info.developer,
      storefront: cc,
      isMine: mine,
      countries: mine ? [] : [cc],
      addedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: apps.trackId,
      set: {
        isMine: mine,
        addedAt: sql`coalesce(${apps.addedAt}, now())`,
        // excluded.countries is [] for an own app, so only a competitor workspace gets one
        countries: sql`case when ${apps.countries} = '{}' then excluded.countries else ${apps.countries} end`,
      },
    });
  if (mine) await cacheListing(id);

  const app = await getApp(id);
  return { app, needsCountries: mine && app.countries.length === 0 };
}

async function summaries(trackId?: number): Promise<AppSummary[]> {
  return db
    .select({
      id: apps.trackId,
      name: apps.name,
      icon: apps.icon,
      developer: apps.developer,
      isMine: apps.isMine,
      storefront: apps.storefront,
      countries: apps.countries,
      language: apps.language,
      schedule: apps.schedule,
      terms: sql<number>`(select count(*) from ${terms}
        where ${terms.appId} = ${apps.trackId} and ${terms.deletedAt} is null)`.mapWith(
        Number,
      ),
      competitors: sql<AppRef[]>`coalesce((
        select jsonb_agg(jsonb_build_object('id', c.track_id, 'name', c.name, 'icon', c.icon)
          order by c.name)
        from app_competitors ac join apps c on c.track_id = ac.competitor_id
        where ac.app_id = ${apps.trackId}), '[]'::jsonb)`,
    })
    .from(apps)
    .where(
      and(
        isNotNull(apps.addedAt),
        trackId === undefined ? undefined : eq(apps.trackId, trackId),
      ),
    )
    .orderBy(desc(apps.isMine), asc(sql`lower(${apps.name})`));
}

/** Workspaces: own apps first, then by name. */
export async function listApps(): Promise<AppSummary[]> {
  return summaries();
}

export async function getApp(id: number): Promise<AppSummary> {
  await appRow(id);
  const [app] = await summaries(id);
  if (!app) throw new UserError("App not found");
  return app;
}

const LOCALES = new Set(Object.values(STOREFRONT_LOCALES));

/** Schedule, main listing language and ownership; a language or ownership change re-caches the listing. */
export async function updateApp(
  id: number,
  patch: { schedule?: Schedule; language?: string; mine?: boolean },
): Promise<void> {
  const app = await appRow(id);
  const p = parse(
    z.object({
      schedule: z.enum(["off", "daily", "weekly"]).optional(),
      language: z
        .string()
        .refine((l) => LOCALES.has(l), "Unknown listing language")
        .optional(),
      mine: z.boolean().optional(),
    }),
    patch,
  );

  await db
    .update(apps)
    .set({
      ...(p.schedule && { schedule: p.schedule }),
      ...(p.language && { language: p.language }),
      ...(p.mine !== undefined && { isMine: p.mine }),
    })
    .where(eq(apps.trackId, id));
  if (
    (p.language && p.language !== app.language) ||
    (p.mine !== undefined && p.mine !== app.isMine)
  ) {
    await cacheListing(id);
  }
}

/**
 * Remove a workspace. An app another workspace compares with keeps its row:
 * its terms, legacy links and own competitors go and it stops being a workspace.
 * Otherwise the row is deleted. Keywords and checks are always kept.
 */
export async function removeApp(id: number): Promise<void> {
  await appRow(id);
  await db.transaction(async (tx) => {
    const [competitor] = await tx
      .select({ appId: appCompetitors.appId })
      .from(appCompetitors)
      .where(eq(appCompetitors.competitorId, id))
      .limit(1);
    if (!competitor) {
      // Cascades to terms, term phrases, legacy links and competitor rows
      await tx.delete(apps).where(eq(apps.trackId, id));
      return;
    }
    await tx.delete(terms).where(eq(terms.appId, id));
    await tx.delete(appKeywords).where(eq(appKeywords.appId, id));
    await tx.delete(appCompetitors).where(eq(appCompetitors.appId, id));
    await tx
      .update(apps)
      .set({ countries: [], addedAt: null, isMine: false })
      .where(eq(apps.trackId, id));
  });
}

/**
 * Apps in the top 10 of the latest check of the app's visible phrases in its
 * storefronts, by how many keywords they appear on (of = keywords checked).
 * Excludes the app itself and existing competitors.
 */
export async function suggestCompetitors(
  id: number,
  limit = 10,
): Promise<{ app: AppRef; count: number; of: number }[]> {
  await appRow(id);
  const n = parse(z.number().int().min(1).max(50), limit);

  const { rows } = await db.execute<{
    // bigint comes back as text from db.execute
    id: string;
    name: string;
    icon: string;
    count: number;
    of: number;
  }>(sql`
    with latest as (
      select p.keyword_id, c.top_apps
      from (
        select distinct tp.keyword_id
        from term_phrases tp
        join terms t on t.id = tp.term_id
        join apps a on a.track_id = t.app_id
        where t.app_id = ${id} and not t.hidden and t.deleted_at is null
          and tp.keyword_id is not null and tp.country = any(a.countries)
      ) p
      join lateral (
        select top_apps from keyword_checks
        where keyword_id = p.keyword_id order by checked_at desc limit 1
      ) c on true
    )
    select (r.app->>'id')::bigint as id,
      (array_agg(r.app->>'name'))[1] as name,
      (array_agg(r.app->>'icon'))[1] as icon,
      count(distinct l.keyword_id)::int as count,
      (select count(*)::int from latest) as "of"
    from latest l
    cross join lateral jsonb_array_elements(l.top_apps) with ordinality r(app, i)
    where r.i <= 10
      and (r.app->>'id')::bigint <> ${id}
      and (r.app->>'id')::bigint not in (
        select competitor_id from app_competitors where app_id = ${id}
      )
    group by 1
    order by count desc, 1
    limit ${n}`);

  return rows.map((r) => ({
    app: { id: Number(r.id), name: r.name ?? "", icon: r.icon ?? "" },
    count: r.count,
    of: r.of,
  }));
}

/**
 * Compare an app with another. Name and icon come from the saved row or the
 * app's stored search results when present, else one lookup.
 */
export async function addCompetitor(
  id: number,
  competitor: { id: number; country?: string },
): Promise<AppRef> {
  await appRow(id);
  const c = parse(
    z.object({ id: appId, country: country.optional() }),
    competitor,
  );
  if (c.id === id) throw new UserError("An app cannot compete with itself");

  const [saved] = await db
    .select({ id: apps.trackId, name: apps.name, icon: apps.icon })
    .from(apps)
    .where(eq(apps.trackId, c.id));
  let ref: AppRef | null = saved ?? null;

  if (!ref) {
    // Latest result naming it among this app's checked phrases
    const { rows } = await db.execute<{
      name: string;
      icon: string;
      country: string;
    }>(sql`
      select r.app->>'name' as name, r.app->>'icon' as icon, k.country
      from term_phrases tp
      join terms t on t.id = tp.term_id
      join keywords k on k.id = tp.keyword_id
      join keyword_checks kc on kc.keyword_id = k.id
      cross join lateral jsonb_array_elements(kc.top_apps) r(app)
      where t.app_id = ${id}
        and kc.top_apps @> jsonb_build_array(jsonb_build_object('id', ${c.id}::bigint))
        and (r.app->>'id')::bigint = ${c.id}
      order by kc.checked_at desc
      limit 1`);
    const stored = rows[0];
    let storefront = c.country ?? stored?.country ?? "us";
    let developer = "";
    if (stored?.name) {
      ref = { id: c.id, name: stored.name, icon: stored.icon ?? "" };
    } else {
      const info = await lookup(c.id, storefront);
      if (!info) throw new UserError("App not found in that storefront");
      ref = { id: c.id, name: info.name, icon: info.icon };
      storefront = info.country;
      developer = info.developer;
    }
    await db
      .insert(apps)
      .values({ trackId: c.id, ...ref, developer, storefront })
      .onConflictDoNothing();
  }

  await db
    .insert(appCompetitors)
    .values({ appId: id, competitorId: c.id })
    .onConflictDoNothing();
  return ref;
}

export async function removeCompetitor(
  id: number,
  competitorId: number,
): Promise<void> {
  await appRow(id);
  const cid = parse(appId, competitorId);
  await db
    .delete(appCompetitors)
    .where(
      and(eq(appCompetitors.appId, id), eq(appCompetitors.competitorId, cid)),
    );
}
