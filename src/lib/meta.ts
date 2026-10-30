import "server-only";

import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appCompetitors, apps, type ListingText } from "@/db/schema";
import { ascConfig, readListing, STOREFRONT_LOCALES } from "@/lib/asc";
import { type AppRow, appRow } from "@/lib/checks";
import { lookupMany, ThrottledError } from "@/lib/itunes";

const LOOKUP_CHUNK = 100;
// Room under the deadline for one more lookup
const CALL_MARGIN_MS = 15_000;

/**
 * Refresh name, icon and developer of apps that are mine, workspaces or
 * competitors, with one batched lookup per 100 apps per storefront. Every app
 * in a looked-up chunk gets refreshed_at, even when Apple left it out or the
 * call failed, so nothing loops; a throttle stops the run. Then re-caches own
 * listings: from App Store Connect when it is configured, else the new name.
 */
export async function refreshAppMeta(input: {
  deadline: number;
}): Promise<{ refreshed: number; missing: number }> {
  const { deadline } = input;
  const due = await db
    .select({
      trackId: apps.trackId,
      storefront: apps.storefront,
      isMine: apps.isMine,
    })
    .from(apps)
    .where(
      and(
        or(
          eq(apps.isMine, true),
          isNotNull(apps.addedAt),
          inArray(
            apps.trackId,
            db.select({ id: appCompetitors.competitorId }).from(appCompetitors),
          ),
        ),
        or(
          isNull(apps.refreshedAt),
          lt(apps.refreshedAt, sql`now() - interval '23 hours'`),
        ),
      ),
    )
    .orderBy(sql`${apps.refreshedAt} asc nulls first`);

  const byStorefront = new Map<string, number[]>();
  for (const a of due) {
    const ids = byStorefront.get(a.storefront) ?? [];
    ids.push(a.trackId);
    byStorefront.set(a.storefront, ids);
  }

  let refreshed = 0;
  let missing = 0;
  const done: number[] = [];
  refresh: for (const [country, ids] of byStorefront) {
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
      if (Date.now() + CALL_MARGIN_MS > deadline) break refresh;
      const chunk = ids.slice(i, i + LOOKUP_CHUNK);
      try {
        const found = await lookupMany(chunk, country, { deadline });
        if (found.length > 0) {
          await db.execute(sql`
            update apps a set name = coalesce(nullif(v.name, ''), a.name),
              icon = coalesce(nullif(v.icon, ''), a.icon),
              developer = v.developer
            from jsonb_to_recordset(${JSON.stringify(found)}::jsonb)
              as v(id bigint, name text, icon text, developer text)
            where a.track_id = v.id`);
        }
        refreshed += found.length;
        missing += chunk.length - found.length;
      } catch (e) {
        if (e instanceof ThrottledError) break refresh;
        console.error(`refreshAppMeta ${country}`, e);
      }
      await db
        .update(apps)
        .set({ refreshedAt: sql`now()` })
        .where(inArray(apps.trackId, chunk));
      done.push(...chunk);
    }
  }

  // Own apps only; without App Store Connect this stores the refreshed name
  const doneSet = new Set(done);
  for (const a of due) {
    if (!a.isMine || !doneSet.has(a.trackId)) continue;
    if (Date.now() + CALL_MARGIN_MS > deadline) break;
    await cacheListing(a.trackId);
  }
  return { refreshed, missing };
}

/**
 * Store the app's listing per locale: App Store Connect (read only) for own
 * apps when it is configured, else the name only. An App Store Connect failure
 * keeps the stored listing.
 */
export async function cacheListing(
  appId: number,
): Promise<Record<string, ListingText>> {
  const app = await appRow(appId, { any: true });
  let listing: Record<string, ListingText> = {
    [app.language]: { name: app.name, subtitle: "", keywords: "" },
  };
  const config = app.isMine ? ascConfig() : null;
  if (config) {
    try {
      listing = (await readListing(config, appId)).locales;
    } catch (e) {
      console.error(`cacheListing ${appId}`, e);
      return app.listing ?? listing;
    }
  }
  await db.update(apps).set({ listing }).where(eq(apps.trackId, appId));
  return listing;
}

/** Name, subtitle and keyword field of the storefront's locale (else the main language), or the app name. */
export function listingText(app: AppRow, country: string): string {
  const l =
    app.listing?.[STOREFRONT_LOCALES[country] ?? app.language] ??
    app.listing?.[app.language];
  return l ? [l.name, l.subtitle, l.keywords].join(" ") : app.name;
}
