import "server-only";

import { importPKCS8, SignJWT } from "jose";

// App Store Connect API: read listings and save draft metadata. Never submits for review.

export const ASC_ENV = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_PRIVATE_KEY"];

/** App Store locale used for each supported storefront. */
export const STOREFRONT_LOCALES: Record<string, string> = {
  us: "en-US",
  gb: "en-GB",
  au: "en-AU",
  ca: "en-CA",
  de: "de-DE",
  at: "de-DE",
  ch: "de-DE",
  fr: "fr-FR",
  be: "fr-FR",
  es: "es-ES",
  mx: "es-MX",
  it: "it",
  nl: "nl-NL",
  pt: "pt-PT",
  br: "pt-BR",
  se: "sv",
  dk: "da",
  fi: "fi",
  no: "no",
  pl: "pl",
  cz: "cs",
  sk: "sk",
  hu: "hu",
  ro: "ro",
  hr: "hr",
  gr: "el",
  tr: "tr",
  ru: "ru",
  ua: "uk",
  il: "he",
  sa: "ar-SA",
  jp: "ja",
  kr: "ko",
  cn: "zh-Hans",
  tw: "zh-Hant",
  hk: "zh-Hant",
  th: "th",
  vn: "vi",
  id: "id",
  my: "ms",
};

export const NAME_MAX = 30;
export const SUBTITLE_MAX = 30;
export const KEYWORDS_MAX = 100;

export type Listing = { name: string; subtitle: string; keywords: string };
export type AscConfig = { keyId: string; issuerId: string; pem: string };

/** Credentials from the environment, or null when any is missing. */
export function ascConfig(): AscConfig | null {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const raw = process.env.ASC_PRIVATE_KEY;
  if (!keyId || !issuerId || !raw) return null;
  // The whole .p8 file base64-encoded, or the PEM itself with \n escapes
  const pem = raw.includes("BEGIN")
    ? raw.replace(/\\n/g, "\n")
    : Buffer.from(raw, "base64").toString("utf8");
  return { keyId, issuerId, pem };
}

/** App Store Connect rejected or failed a request. */
export class AscError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AscError";
  }
}

const TOKEN_TTL_S = 15 * 60; // Apple rejects tokens that live over 20 minutes
let cached: { jwt: string; exp: number; keyId: string } | null = null;

/** ES256 team-key token, reused until a minute before it expires. */
export async function ascToken(
  config: AscConfig,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (cached && cached.keyId === config.keyId && cached.exp - 60 > now) {
    return cached.jwt;
  }
  const key = await importPKCS8(config.pem, "ES256");
  const exp = now + TOKEN_TTL_S;
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId, typ: "JWT" })
    .setIssuer(config.issuerId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience("appstoreconnect-v1")
    .sign(key);
  cached = { jwt, exp, keyId: config.keyId };
  return jwt;
}

// The only requests this app may send. Nothing here can submit for review.
const ALLOWED: [string, RegExp][] = [
  ["GET", /^\/v1\/apps\/\d+\/appStoreVersions$/],
  ["GET", /^\/v1\/appStoreVersions\/[\w-]+\/appStoreVersionLocalizations$/],
  ["GET", /^\/v1\/apps\/\d+\/appInfos$/],
  ["GET", /^\/v1\/appInfos\/[\w-]+\/appInfoLocalizations$/],
  ["POST", /^\/v1\/appStoreVersions$/],
  ["POST", /^\/v1\/appStoreVersionLocalizations$/],
  ["POST", /^\/v1\/appInfoLocalizations$/],
  ["PATCH", /^\/v1\/appStoreVersionLocalizations\/[\w-]+$/],
  ["PATCH", /^\/v1\/appInfoLocalizations\/[\w-]+$/],
];

type Resource<A> = { id: string; attributes: A };

async function asc<T>(
  config: AscConfig,
  method: "GET" | "POST" | "PATCH",
  path: string,
  { query, body }: { query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  if (!ALLOWED.some(([m, p]) => m === method && p.test(path))) {
    throw new AscError(`Blocked App Store Connect request ${method} ${path}`);
  }
  // Fixed host; path is allowlisted above and only appended after it
  const url = new URL(`https://api.appstoreconnect.apple.com/${path.slice(1)}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await ascToken(config)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail ?? data?.errors?.[0]?.title;
    throw new AscError(
      `App Store Connect ${method} ${path} failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return data as T;
}

type Version = Resource<{ versionString: string; appVersionState: string }>;

const EDITABLE = "PREPARE_FOR_SUBMISSION";

async function versions(config: AscConfig, appId: number, editable: boolean) {
  const { data } = await asc<{
    data: (Version & { attributes: { createdDate: string } })[];
  }>(config, "GET", `/v1/apps/${Number(appId)}/appStoreVersions`, {
    query: {
      "filter[platform]": "IOS",
      ...(editable ? { "filter[appVersionState]": EDITABLE } : {}),
      "fields[appStoreVersions]": "versionString,appVersionState,createdDate",
      limit: "10",
    },
  });
  return data.toSorted((a, b) =>
    b.attributes.createdDate.localeCompare(a.attributes.createdDate),
  );
}

async function versionLocalizations(config: AscConfig, versionId: string) {
  const { data } = await asc<{
    data: Resource<{ locale: string; keywords: string | null }>[];
  }>(
    config,
    "GET",
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    {
      query: {
        "fields[appStoreVersionLocalizations]": "locale,keywords",
        limit: "200",
      },
    },
  );
  return data;
}

/** The editable app info when there is one, otherwise the live one. */
async function appInfo(config: AscConfig, appId: number) {
  const { data } = await asc<{ data: Resource<{ state: string }>[] }>(
    config,
    "GET",
    `/v1/apps/${Number(appId)}/appInfos`,
    { query: { "fields[appInfos]": "state" } },
  );
  return data.find((i) => i.attributes.state === EDITABLE) ?? data[0] ?? null;
}

async function appInfoLocalizations(config: AscConfig, appInfoId: string) {
  const { data } = await asc<{
    data: Resource<{
      locale: string;
      name: string | null;
      subtitle: string | null;
    }>[];
  }>(config, "GET", `/v1/appInfos/${appInfoId}/appInfoLocalizations`, {
    query: {
      "fields[appInfoLocalizations]": "locale,name,subtitle",
      limit: "200",
    },
  });
  return data;
}

export type AscListing = {
  /** The editable version, else the newest one */
  version: { versionString: string; state: string } | null;
  editable: boolean;
  locales: Record<string, Listing>;
};

/** Name, subtitle and keyword field per locale, from the editable version when there is one. */
export async function readListing(
  config: AscConfig,
  appId: number,
): Promise<AscListing> {
  const [all, info] = await Promise.all([
    versions(config, appId, false),
    appInfo(config, appId),
  ]);
  const version =
    all.find((v) => v.attributes.appVersionState === EDITABLE) ??
    all[0] ??
    null;
  const [vLocs, iLocs] = await Promise.all([
    version ? versionLocalizations(config, version.id) : [],
    info ? appInfoLocalizations(config, info.id) : [],
  ]);

  const locales: Record<string, Listing> = {};
  const get = (locale: string) => {
    locales[locale] ??= { name: "", subtitle: "", keywords: "" };
    return locales[locale];
  };
  for (const l of iLocs) {
    get(l.attributes.locale).name = l.attributes.name ?? "";
    get(l.attributes.locale).subtitle = l.attributes.subtitle ?? "";
  }
  for (const l of vLocs) {
    get(l.attributes.locale).keywords = l.attributes.keywords ?? "";
  }
  return {
    version: version
      ? {
          versionString: version.attributes.versionString,
          state: version.attributes.appVersionState,
        }
      : null,
    editable: version?.attributes.appVersionState === EDITABLE,
    locales,
  };
}

/**
 * Write name, subtitle and keyword field per locale to the version in
 * Prepare for Submission, creating that version when none exists.
 * Only creates and updates draft metadata; never submits for review.
 */
export async function saveDraft(
  config: AscConfig,
  appId: number,
  drafts: (Listing & { locale: string })[],
  newVersionString: string | null,
): Promise<{ versionString: string; created: boolean; notes: string[] }> {
  const notes: string[] = [];
  let version: Version | undefined = (await versions(config, appId, true))[0];
  let created = false;
  if (!version) {
    if (!newVersionString) {
      throw new AscError(
        "No version is in Prepare for Submission. Enter a version number to create one.",
      );
    }
    ({ data: version } = await asc<{ data: Version }>(
      config,
      "POST",
      "/v1/appStoreVersions",
      {
        body: {
          data: {
            type: "appStoreVersions",
            attributes: {
              platform: "IOS",
              versionString: newVersionString,
              releaseType: "MANUAL",
            },
            relationships: {
              app: { data: { type: "apps", id: String(appId) } },
            },
          },
        },
      },
    ));
    created = true;
  }

  // Keyword field lives on the version localization
  const vLocs = await versionLocalizations(config, version.id);
  for (const d of drafts) {
    const existing = vLocs.find((l) => l.attributes.locale === d.locale);
    if (existing) {
      await asc(
        config,
        "PATCH",
        `/v1/appStoreVersionLocalizations/${existing.id}`,
        {
          body: {
            data: {
              type: "appStoreVersionLocalizations",
              id: existing.id,
              attributes: { keywords: d.keywords },
            },
          },
        },
      );
    } else {
      await asc(config, "POST", "/v1/appStoreVersionLocalizations", {
        body: {
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale: d.locale, keywords: d.keywords },
            relationships: {
              appStoreVersion: {
                data: { type: "appStoreVersions", id: version.id },
              },
            },
          },
        },
      });
      notes.push(
        `Added ${d.locale}; fill in its description before submitting.`,
      );
    }
  }

  // Name and subtitle live on the editable app info
  const info = await appInfo(config, appId);
  if (!info || info.attributes.state !== EDITABLE) {
    notes.push(
      "No editable app info, so name and subtitle were not saved. Change them in App Store Connect.",
    );
  } else {
    const iLocs = await appInfoLocalizations(config, info.id);
    for (const d of drafts) {
      const attributes = { name: d.name, subtitle: d.subtitle };
      const existing = iLocs.find((l) => l.attributes.locale === d.locale);
      if (existing) {
        await asc(config, "PATCH", `/v1/appInfoLocalizations/${existing.id}`, {
          body: {
            data: {
              type: "appInfoLocalizations",
              id: existing.id,
              attributes,
            },
          },
        });
      } else {
        await asc(config, "POST", "/v1/appInfoLocalizations", {
          body: {
            data: {
              type: "appInfoLocalizations",
              attributes: { locale: d.locale, ...attributes },
              relationships: {
                appInfo: { data: { type: "appInfos", id: info.id } },
              },
            },
          },
        });
      }
    }
  }

  return { versionString: version.attributes.versionString, created, notes };
}
