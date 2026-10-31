import "server-only";

import type { TopApp } from "@/db/schema";
import {
  reportSuccess,
  reportThrottle,
  ThrottledError,
  takeSlot,
} from "@/lib/gate";

// Defined in gate.ts so the gate errors can extend it without an import cycle
export { ThrottledError };

/** Apple rejected the request (400); the storefront code is not one it knows. */
export class InvalidStorefrontError extends Error {
  constructor(country: string) {
    super(`Unknown storefront ${country}`);
    this.name = "InvalidStorefrontError";
  }
}

type CallOpts = { deadline?: number };

/** One app as Apple describes it in a storefront; ratings are per storefront. */
export type AppInfo = {
  id: number;
  name: string;
  icon: string;
  developer: string;
  ratings: number;
  country: string;
};

/** Every call takes a gate slot first; throttles pause the whole deployment. */
async function request(
  url: string,
  what: string,
  country: string,
  opts?: CallOpts,
): Promise<Record<string, unknown>[]> {
  await takeSlot(opts?.deadline);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (res.status === 403 || res.status === 429) {
    await reportThrottle();
    throw new ThrottledError(`App Store ${what} is rate limited`);
  }
  // Terms are encoded and ids are numbers, so a 400 means Apple does not know the storefront
  if (res.status === 400) throw new InvalidStorefrontError(country);
  if (!res.ok) throw new Error(`App Store ${what} failed (${res.status})`);

  let data: { results?: Record<string, unknown>[] };
  try {
    data = await res.json();
  } catch {
    await reportThrottle();
    throw new ThrottledError(`App Store ${what} returned a non-JSON response`);
  }
  await reportSuccess();
  return data.results ?? [];
}

function toAppInfo(r: Record<string, unknown>, country: string): AppInfo {
  return {
    id: r.trackId as number,
    name: (r.trackName as string) ?? "",
    icon: (r.artworkUrl100 as string) ?? "",
    developer: (r.artistName as string) ?? "",
    ratings: (r.userRatingCount as number) ?? 0,
    country,
  };
}

/** App Store search results for a phrase in one storefront, in rank order. */
export async function search(
  phrase: string,
  country: string,
  opts?: CallOpts,
): Promise<TopApp[]> {
  const results = await request(
    `https://itunes.apple.com/search?term=${encodeURIComponent(phrase)}&country=${country}&entity=software&limit=200`,
    "search",
    country,
    opts,
  );
  return results.flatMap((r) =>
    typeof r.trackId === "number"
      ? [
          {
            id: r.trackId,
            name: (r.trackName as string) ?? "",
            icon: (r.artworkUrl100 as string) ?? "",
            ratings: (r.userRatingCount as number) ?? 0,
            avg: (r.averageUserRating as number) ?? 0,
          },
        ]
      : [],
  );
}

/** One app in a storefront (US by default), or null when Apple has no such app there. */
export async function lookup(
  id: number,
  country = "us",
  opts?: CallOpts,
): Promise<AppInfo | null> {
  const results = await request(
    `https://itunes.apple.com/lookup?id=${id}&country=${country}`,
    "lookup",
    country,
    opts,
  );
  const app = results.find((r) => r.trackId === id);
  return app ? toAppInfo(app, country) : null;
}

/** Up to 100 ids in one request; apps Apple does not have in the storefront are left out. */
export async function lookupMany(
  ids: number[],
  country: string,
  opts?: CallOpts,
): Promise<AppInfo[]> {
  if (ids.length === 0) return [];
  if (ids.length > 100) throw new Error("Look up at most 100 apps at a time");
  const wanted = new Set(ids);
  const results = await request(
    `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}`,
    "lookup",
    country,
    opts,
  );
  return results.flatMap((r) =>
    typeof r.trackId === "number" && wanted.has(r.trackId)
      ? [toAppInfo(r, country)]
      : [],
  );
}

/** Apps matching a name in one storefront, top 10 in App Store order. */
export async function findApps(
  term: string,
  country: string,
  opts?: CallOpts,
): Promise<AppInfo[]> {
  const results = await request(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&entity=software&limit=10`,
    "search",
    country,
    opts,
  );
  return results.flatMap((r) =>
    typeof r.trackId === "number" ? [toAppInfo(r, country)] : [],
  );
}

/**
 * apps.apple.com/<cc>/app/<slug?>/id<digits>, id<digits> or bare digits →
 * { id, country } (US unless the link names a storefront); null for a name.
 */
export function parseAppLink(
  text: string,
): { id: number; country: string } | null {
  const s = text.trim();
  const link = s.match(
    /(?:apps|itunes)\.apple\.com\/(?:([a-z]{2})\/)?app\/(?:[^/?#]+\/)?id(\d{1,15})/i,
  );
  // Bare digits need 6 or more so short numeric app names (2048) stay names
  const digits = link?.[2] ?? s.match(/^(?:id)?(\d{6,15})$/i)?.[1];
  if (!digits) return null;
  const id = Number(digits);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, country: link?.[1]?.toLowerCase() ?? "us" };
}
