import { sql } from "drizzle-orm";
import { db } from "@/db";
import { UserError } from "@/lib/checks";
import { loadTrack } from "@/lib/terms";
import { type CountryTrack, TrackView } from "./track-view";

type Props = {
  appId: number;
  isMine: boolean;
  /** Storefront codes from the country bar, in display order */
  countries: string[];
};

/** Rating count of each app in the latest check of the given keywords, newest first. */
async function ratingCounts(
  keywordIds: number[],
  appIds: number[],
): Promise<Map<number, number>> {
  if (keywordIds.length === 0 || appIds.length === 0) return new Map();
  const { rows } = await db.execute<{ id: string; ratings: number | null }>(
    sql`
      select distinct on (1) (r.app->>'id')::bigint as id,
        (r.app->>'ratings')::int as ratings
      from keywords k
      -- Only each keyword's latest check, so cost does not grow with history
      join lateral (
        select top_apps, checked_at from keyword_checks
        where keyword_id = k.id
        order by checked_at desc
        limit 1
      ) kc on true
      cross join lateral jsonb_array_elements(kc.top_apps) r(app)
      where k.id in ${keywordIds}
        and (r.app->>'id')::bigint in ${appIds}
      order by 1, kc.checked_at desc`,
  );
  return new Map(
    rows.flatMap((r) =>
      r.ratings === null ? [] : [[Number(r.id), r.ratings]],
    ),
  );
}

export async function TrackTab({ appId, countries }: Props) {
  // Every country up front, so switching cards or views needs no round trip
  const loaded = await Promise.all(
    countries.map((country) =>
      loadTrack(appId, country).catch((e) => {
        // Not a researched storefront of the app (yet)
        if (e instanceof UserError) return null;
        throw e;
      }),
    ),
  );
  const tracks = loaded.filter((t) => t !== null);

  const ratings = await ratingCounts(
    [...new Set(tracks.flatMap((t) => t.rows.map((r) => r.keywordId)))],
    [...new Set(tracks.flatMap((t) => t.losingTo.map((l) => l.app.id)))],
  );
  const data: CountryTrack[] = tracks.map((t) => ({
    ...t,
    losingTo: t.losingTo.map((l) => ({
      ...l,
      ratings: ratings.get(l.app.id) ?? null,
    })),
  }));

  return <TrackView appId={appId} tracks={data} />;
}
