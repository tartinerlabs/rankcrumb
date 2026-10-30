import "server-only";

import { generateText, Output } from "ai";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  apps,
  keywords,
  type ListingText,
  termPhrases,
  terms,
} from "@/db/schema";
import { describeAiError, MODEL } from "@/lib/ai";
import {
  AscError,
  ascConfig,
  KEYWORDS_MAX,
  NAME_MAX,
  readListing,
  STOREFRONT_LOCALES,
  SUBTITLE_MAX,
  saveDraft,
} from "@/lib/asc";
import { type AppRow, appRow, latestChecks, UserError } from "@/lib/checks";
import { cacheListing } from "@/lib/meta";
import { isCovered, normalize } from "@/lib/scoring";

const MAX_LOCALES = 5;
const MAX_OPTIONS = 3;
// Keywords per locale sent to the model, best first
const MAX_PROMPT_KEYWORDS = 40;
const MAX_PHRASE_LENGTH = 100;

export type Scored = ListingText & {
  /** Sum of the latest volume of the covered phrases */
  reach: number;
  /** Average latest difficulty of the covered phrases; null when none is checked */
  difficulty: number | null;
  covered: string[];
};

export type LocaleProposal = {
  country: string;
  locale: string;
  current: Scored;
  options: (Scored & { reachChange: number })[];
};

type Phrase = {
  phrase: string;
  volume: number | null;
  difficulty: number | null;
  rank: number | null;
};

const EMPTY: ListingText = { name: "", subtitle: "", keywords: "" };

/** The listing per locale: App Store Connect for an own app when connected, else the public name. Stores it on the app. */
export async function loadListing(appId: number): Promise<{
  source: "asc" | "public";
  version: { versionString: string; state: string } | null;
  editable: boolean;
  locales: Record<string, ListingText>;
}> {
  const app = await appRow(appId);
  const config = app.isMine ? ascConfig() : null;
  if (config) {
    try {
      const listing = await readListing(config, appId);
      // Same value cacheListing stores, without reading App Store Connect twice
      await db
        .update(apps)
        .set({ listing: listing.locales })
        .where(eq(apps.trackId, appId));
      return { source: "asc", ...listing };
    } catch (e) {
      console.error(`loadListing ${appId}`, e);
    }
  }
  const locales = config
    ? (app.listing ?? (await cacheListing(appId)))
    : await cacheListing(appId);
  return { source: "public", version: null, editable: false, locales };
}

/** Main-language keyword field items, then name and subtitle parts split on - : | , that are not terms yet. */
export async function importCandidates(appId: number): Promise<string[]> {
  const app = await appRow(appId);
  const listing = app.listing ?? (await cacheListing(appId));
  const main = listing[app.language] ?? {
    ...EMPTY,
    name: app.name,
  };
  const existing = await db
    .select({ label: terms.label })
    .from(terms)
    .where(and(eq(terms.appId, appId), isNull(terms.deletedAt)));
  const seen = new Set(existing.map((t) => t.label));

  const out: string[] = [];
  const parts = [
    ...main.keywords.split(","),
    ...`${main.name},${main.subtitle}`.split(/\s+[-–—]\s+|[:|,]/),
  ];
  for (const raw of parts) {
    const label = normalize(raw);
    if (!label || label.length > MAX_PHRASE_LENGTH || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** Cut to max characters at a word boundary when possible, without dangling separators. */
function fit(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  if (space > max / 2) cut = cut.slice(0, space);
  return cut.replace(/[\s\-–—:,|&+]+$/u, "");
}

/** Single words, comma-separated, no spaces, none already in the name or subtitle, at most 100 characters. */
function keywordField(raw: string, name: string, subtitle: string): string {
  const used = new Set(normalize(`${name} ${subtitle}`).split(" "));
  const out: string[] = [];
  let length = 0;
  for (const word of normalize(raw).split(" ")) {
    if (!word || used.has(word)) continue;
    const add = word.length + (out.length > 0 ? 1 : 0);
    if (length + add > KEYWORDS_MAX) continue; // a shorter word may still fit
    used.add(word);
    out.push(word);
    length += add;
  }
  return out.join(",");
}

/** Reach and difficulty of the phrases a listing covers. */
function score(listing: ListingText, phrases: Phrase[]): Scored {
  const text = `${listing.name} ${listing.subtitle} ${listing.keywords}`;
  const covered = phrases.filter((p) => isCovered(p.phrase, text));
  const checked = covered.filter((p) => p.difficulty !== null);
  return {
    ...listing,
    reach: covered.reduce((sum, p) => sum + (p.volume ?? 0), 0),
    difficulty:
      checked.length === 0
        ? null
        : Math.round(
            checked.reduce((sum, p) => sum + (p.difficulty ?? 0), 0) /
              checked.length,
          ),
    covered: covered.map((p) => p.phrase),
  };
}

/** Visible phrases of the app in the storefronts with their latest check, best value first. */
async function loadPhrases(appId: number, countries: string[]) {
  const rows = await db
    .select({
      keywordId: keywords.id,
      country: keywords.country,
      phrase: keywords.phrase,
    })
    .from(termPhrases)
    .innerJoin(terms, eq(terms.id, termPhrases.termId))
    .innerJoin(keywords, eq(keywords.id, termPhrases.keywordId))
    .where(
      and(
        eq(terms.appId, appId),
        eq(terms.hidden, false),
        isNull(terms.deletedAt),
        inArray(termPhrases.country, countries),
      ),
    );
  const latest = await latestChecks(
    rows.map((r) => r.keywordId),
    { appId },
  );
  const byCountry = new Map<string, Phrase[]>();
  const seen = new Set<number>();
  for (const r of rows) {
    // Two terms can share a keyword; count it once
    if (seen.has(r.keywordId)) continue;
    seen.add(r.keywordId);
    const l = latest.get(r.keywordId);
    const list = byCountry.get(r.country) ?? [];
    list.push({
      phrase: r.phrase,
      volume: l?.volume ?? null,
      difficulty: l?.difficulty ?? null,
      rank: l?.rank ?? null,
    });
    byCountry.set(r.country, list);
  }
  for (const list of byCountry.values()) {
    list.sort(
      (a, b) =>
        (b.volume ?? 0) -
          (b.difficulty ?? 100) / 2 -
          ((a.volume ?? 0) - (a.difficulty ?? 100) / 2) ||
        a.phrase.localeCompare(b.phrase),
    );
  }
  return byCountry;
}

/** Current listing per locale: App Store Connect when connected, else the stored listing or the app name. */
async function currentListing(app: AppRow, locales: string[]) {
  const current = new Map<string, ListingText>();
  const config = ascConfig();
  if (config) {
    try {
      const listing = await readListing(config, app.trackId);
      for (const locale of locales) {
        current.set(locale, listing.locales[locale] ?? EMPTY);
      }
      return {
        current,
        source: "asc" as const,
        all: Object.keys(listing.locales),
      };
    } catch (e) {
      console.error("proposeListing readListing", e);
      const warning = `Could not read App Store Connect (${e instanceof AscError ? e.message : "request failed"}); comparing against the public name only.`;
      return { ...publicListing(app, locales), warning };
    }
  }
  return publicListing(app, locales);
}

function publicListing(app: AppRow, locales: string[]) {
  const current = new Map<string, ListingText>();
  for (const locale of locales) {
    current.set(locale, app.listing?.[locale] ?? { ...EMPTY, name: app.name });
  }
  return {
    current,
    source: "public" as const,
    all: Object.keys(app.listing ?? {}),
  };
}

const proposalSchema = z.object({
  listings: z.array(
    z.object({
      locale: z.string().describe("Locale code, exactly as given"),
      options: z
        .array(
          z.object({
            name: z.string(),
            subtitle: z.string(),
            keywords: z
              .string()
              .describe("Single words separated by commas, no spaces"),
          }),
        )
        .describe(`${MAX_OPTIONS} distinct options, best first`),
    }),
  ),
});

/**
 * Up to 3 AI listings (name, subtitle, keyword field) per storefront of an own
 * app, built from its visible phrases and scored by the phrases each covers.
 */
export async function proposeListing(
  appId: number,
  countries: string[],
): Promise<{
  proposals: LocaleProposal[];
  otherLocales: string[];
  source: "asc" | "public";
  warning?: string;
}> {
  const parsed = z
    .array(z.string().regex(/^[a-z]{2}$/, "Storefront codes are two letters"))
    .min(1, "Pick at least one storefront")
    .max(MAX_LOCALES, `Pick at most ${MAX_LOCALES} storefronts`)
    .safeParse([...new Set(countries)]);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const app = await appRow(appId, { mine: true });
  const picked = parsed.data.map((country) => ({
    country,
    locale: STOREFRONT_LOCALES[country],
  }));
  const unsupported = picked.find((p) => !p.locale);
  if (unsupported) {
    throw new UserError(
      `No App Store locale mapped for ${unsupported.country.toUpperCase()}`,
    );
  }
  const shared = picked.find(
    (p, i) => picked.findIndex((q) => q.locale === p.locale) !== i,
  );
  if (shared) {
    throw new UserError(
      `Two storefronts use ${shared.locale}; pick one of them`,
    );
  }

  const phrases = await loadPhrases(appId, parsed.data);
  const empty = picked.find((p) => !phrases.get(p.country)?.length);
  if (empty) {
    throw new UserError(
      `No keywords in ${empty.country.toUpperCase()}. Add some first.`,
    );
  }

  const pickedLocales = picked.map((p) => p.locale);
  const { current, source, all, ...rest } = await currentListing(
    app,
    pickedLocales,
  );
  let warning = "warning" in rest ? rest.warning : undefined;

  const blocks = picked.map(({ country, locale }) => {
    const now = current.get(locale);
    const lines = (phrases.get(country) ?? [])
      .slice(0, MAX_PROMPT_KEYWORDS)
      .map(
        (k) =>
          `- ${k.phrase}: volume ${k.volume ?? "?"}, difficulty ${k.difficulty ?? "?"}, placement ${k.rank ?? "not in top 200"}`,
      );
    return `Locale ${locale} (storefront ${country})\nCurrent name: ${now?.name || "(none)"}\nCurrent subtitle: ${now?.subtitle || "(none)"}\nCurrent keyword field: ${now?.keywords || "(none)"}\nTracked keywords:\n${lines.join("\n")}`;
  });

  let listings: z.infer<typeof proposalSchema>["listings"];
  try {
    const { output } = await generateText({
      model: MODEL,
      instructions: `You are an App Store optimization copywriter. For each locale, write ${MAX_OPTIONS} distinct options of a new name, subtitle and keyword field in that locale's language, built from its tracked keywords. Volume (0-100) is how strongly the top 50 apps target a phrase in their names: an indirect sign of demand, not Apple search popularity. Difficulty (0-100): lower is easier to rank for. Favour high volume with low difficulty, and put the most valuable phrases in the name and subtitle, which weigh most. Keep the app's brand (the part of the current name before any dash or colon) at the start of the name. Name at most ${NAME_MAX} characters, subtitle at most ${SUBTITLE_MAX}, both natural and readable. Keyword field at most ${KEYWORDS_MAX} characters: single words separated by commas with no spaces, no word already used in the name or subtitle, no plural duplicates, no other apps' brand names.`,
      prompt: `Return one entry per locale with ${MAX_OPTIONS} options each.\n\n${blocks.join("\n\n")}`,
      output: Output.object({ schema: proposalSchema }),
      maxOutputTokens: 4000,
      timeout: 45_000,
    });
    listings = output.listings;
  } catch (e) {
    console.error("proposeListing", e);
    throw new UserError(describeAiError(e));
  }

  // Enforce Apple's limits in code; the model is only asked to respect them
  const skipped: string[] = [];
  const proposals = picked.map(({ country, locale }): LocaleProposal => {
    const list = phrases.get(country) ?? [];
    const now = score(current.get(locale) ?? EMPTY, list);
    const options: LocaleProposal["options"] = [];
    const seen = new Set<string>();
    const l = listings.find((x) => x.locale.trim() === locale);
    for (const o of l?.options ?? []) {
      if (options.length === MAX_OPTIONS) break;
      const name = fit(o.name, NAME_MAX);
      const subtitle = fit(o.subtitle, SUBTITLE_MAX);
      const option = {
        name,
        subtitle,
        keywords: keywordField(o.keywords, name, subtitle),
      };
      const key = JSON.stringify(option);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const scored = score(option, list);
      options.push({ ...scored, reachChange: scored.reach - now.reach });
    }
    if (options.length === 0) skipped.push(locale);
    return { country, locale, current: now, options };
  });
  if (skipped.length > 0) {
    const note = `The AI skipped ${skipped.join(", ")}; those have no options.`;
    warning = warning ? `${warning} ${note}` : note;
  }
  return {
    proposals,
    otherLocales: all.filter((l) => !pickedLocales.includes(l)),
    source,
    warning,
  };
}

const draftsInput = z.object({
  appId: z.number().int().positive(),
  confirmed: z.literal(true, "Confirm before saving"),
  versionString: z
    .string()
    .trim()
    .regex(/^(\d+\.){0,2}\d+$/, "Version numbers look like 1.2.0")
    .or(z.literal(""))
    .nullable(),
  drafts: z
    .array(
      z.object({
        locale: z
          .string()
          .refine((l) => Object.values(STOREFRONT_LOCALES).includes(l)),
        name: z
          .string()
          .trim()
          .min(1, "Every locale needs a name")
          .max(NAME_MAX, `Names are at most ${NAME_MAX} characters`),
        subtitle: z
          .string()
          .trim()
          .max(
            SUBTITLE_MAX,
            `Subtitles are at most ${SUBTITLE_MAX} characters`,
          ),
        keywords: z
          .string()
          .trim()
          .max(
            KEYWORDS_MAX,
            `Keyword fields are at most ${KEYWORDS_MAX} characters`,
          )
          .regex(/^\S*$/, "Keyword fields cannot contain spaces"),
      }),
    )
    .min(1)
    .max(MAX_LOCALES),
});

/** Save the listing to a draft version in App Store Connect. Never submits for review. UI only. */
export async function saveListingDraft(input: {
  appId: number;
  confirmed: true;
  versionString: string | null;
  drafts: ({ locale: string } & ListingText)[];
}): Promise<{ message: string }> {
  const config = ascConfig();
  if (!config) throw new UserError("App Store Connect is not connected");
  const parsed = draftsInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const { appId, drafts, versionString } = parsed.data;
  await appRow(appId, { mine: true });

  try {
    const saved = await saveDraft(config, appId, drafts, versionString || null);
    const where = saved.created
      ? `new version ${saved.versionString}`
      : `version ${saved.versionString}`;
    return {
      message: [
        `Saved ${drafts.length} locale${drafts.length === 1 ? "" : "s"} to ${where} as a draft. Nothing was submitted for review.`,
        ...saved.notes,
      ].join(" "),
    };
  } catch (e) {
    console.error("saveListingDraft", e);
    throw new UserError(
      e instanceof AscError ? e.message : "App Store Connect failed",
    );
  }
}
