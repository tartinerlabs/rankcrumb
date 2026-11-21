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

/** { [key]: "YYYY-MM-DD" } from an Apple timestamp, or nothing when it is missing or invalid. */
function isoDay<K extends string>(key: K, value: unknown) {
  if (typeof value !== "string") return {};
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? ({ [key]: day } as Record<K, string>)
    : {};
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
            ...isoDay("released", r.releaseDate),
            ...isoDay("updated", r.currentVersionReleaseDate),
            ...(typeof r.price === "number" && { price: r.price }),
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

// App Store storefront ids for the search hints header, from app-store-scraper 0.18.0 (lib/constants.js).
// Storefronts missing here get no demand score.
const STOREFRONT_IDS: Record<string, number> = {
  ae: 143481,
  ai: 143538,
  am: 143524,
  ao: 143564,
  ar: 143505,
  at: 143445,
  au: 143460,
  az: 143568,
  bb: 143541,
  be: 143446,
  bg: 143526,
  bh: 143559,
  bm: 143542,
  bn: 143560,
  bo: 143556,
  br: 143503,
  bw: 143525,
  by: 143565,
  bz: 143555,
  ca: 143455,
  ch: 143459,
  cl: 143483,
  cn: 143465,
  co: 143501,
  cr: 143495,
  cy: 143557,
  cz: 143489,
  de: 143443,
  dk: 143458,
  dm: 143545,
  dz: 143563,
  ec: 143509,
  ee: 143518,
  eg: 143516,
  es: 143454,
  fi: 143447,
  fr: 143442,
  gb: 143444,
  gd: 143546,
  gh: 143573,
  gr: 143448,
  gt: 143504,
  gy: 143553,
  hk: 143463,
  hn: 143510,
  hr: 143494,
  hu: 143482,
  id: 143476,
  ie: 143449,
  il: 143491,
  in: 143467,
  is: 143558,
  it: 143450,
  jm: 143511,
  jo: 143528,
  jp: 143462,
  ke: 143529,
  kr: 143466,
  kw: 143493,
  ky: 143544,
  lb: 143497,
  lk: 143486,
  lt: 143520,
  lu: 143451,
  lv: 143519,
  mg: 143531,
  mk: 143530,
  ml: 143532,
  mo: 143515,
  ms: 143547,
  mt: 143521,
  mu: 143533,
  mx: 143468,
  my: 143473,
  ne: 143534,
  ng: 143561,
  ni: 143512,
  nl: 143452,
  no: 143457,
  np: 143484,
  nz: 143461,
  om: 143562,
  pa: 143485,
  pe: 143507,
  ph: 143474,
  pk: 143477,
  pl: 143478,
  pt: 143453,
  py: 143513,
  qa: 143498,
  ro: 143487,
  ru: 143469,
  sa: 143479,
  se: 143456,
  sg: 143464,
  si: 143499,
  sk: 143496,
  sn: 143535,
  sr: 143554,
  sv: 143506,
  th: 143475,
  tn: 143536,
  tr: 143480,
  tw: 143470,
  tz: 143572,
  ua: 143492,
  ug: 143537,
  us: 143441,
  uy: 143514,
  uz: 143566,
  ve: 143502,
  vg: 143543,
  vn: 143471,
  ye: 143571,
  za: 143472,
};

const HINTS_TIMEOUT_MS = 8_000;

const decodeXml = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/**
 * App Store search suggestions for what a user has typed, in Apple's order (up
 * to 10), or null when the storefront has no known id. A separate Apple host
 * from search, so it takes no gate slot. Failures, an abort of `signal` and a
 * reply that is not a suggestions plist throw a plain Error.
 */
export async function searchHints(
  typed: string,
  country: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const storefront = STOREFRONT_IDS[country];
  if (!storefront) return null;
  const res = await fetch(
    `https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints?clientApplication=Software&term=${encodeURIComponent(typed)}`,
    {
      headers: { "X-Apple-Store-Front": String(storefront) },
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(HINTS_TIMEOUT_MS), signal])
        : AbortSignal.timeout(HINTS_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`App Store search hints failed (${res.status})`);
  const xml = await res.text();
  // An empty list is still <key>hints</key><array></array>; anything else (an error page) is not an answer
  if (!/<key>hints<\/key>\s*<array\s*\/?>/.test(xml)) {
    throw new Error("App Store search hints returned an unexpected reply");
  }
  return [...xml.matchAll(/<key>term<\/key>\s*<string>([^<]*)<\/string>/g)].map(
    (m) => decodeXml(m[1]),
  );
}
