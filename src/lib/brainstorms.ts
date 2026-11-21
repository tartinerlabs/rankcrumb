import "server-only";

import { generateText, Output } from "ai";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { brainstorms, keywords, type Platform, type TopApp } from "@/db/schema";
import { describeAiError, MODEL } from "@/lib/ai";
import {
  type Latest,
  latestChecks,
  type Pair,
  pairKey,
  UserError,
  upsertKeywords,
} from "@/lib/checks";
import { enqueue } from "@/lib/queue";
import { type IdeaVerdict, ideaVerdict, normalize } from "@/lib/scoring";

const MAX_STOREFRONTS = 5;
const MAX_IDEA = 4000;
// Phrases asked for and kept across all storefronts
const TARGET_PHRASES = 20;
const MAX_PHRASES = 25;
const HOUR_MS = 3_600_000;

export type BrainstormSummary = {
  id: number;
  idea: string;
  countries: string[];
  platform: Platform;
  createdAt: string;
  keywords: number;
};

const idField = z.number().int().positive();

const brainstormInput = z.object({
  idea: z
    .string()
    .trim()
    .min(20, "Describe the idea in a sentence or two")
    .max(MAX_IDEA, `Keep the idea under ${MAX_IDEA} characters`),
  countries: z
    .array(z.string().regex(/^[a-z]{2}$/, "Storefront codes are two letters"))
    .default(["us"])
    .transform((c) => [...new Set(c)])
    .pipe(
      z
        .array(z.string())
        .min(1, "Pick at least one storefront")
        .max(MAX_STOREFRONTS, `Pick at most ${MAX_STOREFRONTS} storefronts`),
    ),
  platform: z.enum(["ios", "mac"]).default("ios"),
});

const ideasSchema = z.object({
  results: z.array(
    z.object({
      country: z.string().describe("Storefront code, exactly as given"),
      keywords: z
        .array(z.string())
        .describe("App Store search phrases, most relevant first"),
    }),
  ),
});

/** Save a niche idea with AI keyword phrases per storefront, then queue their checks. */
export async function createBrainstorm(input: {
  idea: string;
  countries?: string[];
  platform?: Platform;
}): Promise<{ id: number }> {
  const parsed = brainstormInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const { idea, countries, platform } = parsed.data;
  const perCountry = Math.round(TARGET_PHRASES / countries.length);
  const maxPerCountry = Math.floor(MAX_PHRASES / countries.length);

  let results: z.infer<typeof ideasSchema>["results"];
  try {
    const { output } = await generateText({
      model: MODEL,
      instructions:
        'You are an App Store keyword researcher. Suggest short phrases people really type into App Store search to find an app like the one described: its core function, use cases, problems solved and synonyms. Write each storefront\'s phrases in its primary language and script. Lowercase, 1 to 3 words. No brand or competitor names, no filler like "app" or "free", no duplicates.',
      prompt: `Store: ${platform === "mac" ? "Mac App Store" : "iPhone and iPad App Store"}\nStorefronts: ${countries.join(", ")}\nReturn one entry per storefront with ${perCountry} keywords each.\n\nApp idea:\n${idea}`,
      output: Output.object({ schema: ideasSchema }),
      maxOutputTokens: 2000,
      timeout: 45_000,
    });
    results = output.results;
  } catch (e) {
    console.error("createBrainstorm", e);
    throw new UserError(describeAiError(e));
  }

  // Keep only requested storefronts, normalised, deduplicated, capped
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const r of results) {
    const country = r.country.trim().toLowerCase();
    if (!countries.includes(country)) continue;
    let taken = 0;
    for (const raw of r.keywords) {
      const phrase = normalize(raw);
      const key = `${country}:${phrase}`;
      if (!phrase || phrase.length > 100 || seen.has(key)) continue;
      if (taken === maxPerCountry) break;
      seen.add(key);
      pairs.push({ country, phrase, platform });
      taken++;
    }
  }
  if (pairs.length === 0) {
    throw new UserError("The AI returned no usable keywords. Try again.");
  }

  const ids = await upsertKeywords(pairs);
  const keywordIds = pairs.map((p) => ids.get(pairKey(p)) as number);
  const [row] = await db
    .insert(brainstorms)
    .values({ idea, countries, platform, keywordIds })
    .returning({ id: brainstorms.id });
  await enqueue(keywordIds, { maxAgeMs: 24 * HOUR_MS, priority: 0 });
  return { id: row.id };
}

/** Saved brainstorms, newest first. */
export async function listBrainstorms(): Promise<BrainstormSummary[]> {
  const rows = await db
    .select({
      id: brainstorms.id,
      idea: brainstorms.idea,
      countries: brainstorms.countries,
      platform: brainstorms.platform,
      createdAt: brainstorms.createdAt,
      keywords: sql<number>`cardinality(${brainstorms.keywordIds})::int`,
    })
    .from(brainstorms)
    .orderBy(desc(brainstorms.createdAt), desc(brainstorms.id));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** Top 10 apps with ratings and dates of each keyword's latest check. */
async function latestTop(keywordIds: number[]): Promise<Map<number, TopApp[]>> {
  const ids = [...new Set(keywordIds)];
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<{ keyword_id: number; top: TopApp[] }>(sql`
    select k.id as keyword_id, jsonb_path_query_array(c.top_apps, '$[0 to 9]') as top
    from keywords k
    join lateral (
      select top_apps from keyword_checks
      where keyword_id = k.id order by checked_at desc limit 1
    ) c on true
    where k.id in ${ids}`);
  return new Map(rows.map((r) => [r.keyword_id, r.top]));
}

/** A brainstorm with its phrases in AI order, their latest checks, and a verdict per storefront in its order. */
export async function getBrainstorm(id: number): Promise<{
  id: number;
  idea: string;
  countries: string[];
  platform: Platform;
  createdAt: string;
  rows: {
    keywordId: number;
    country: string;
    phrase: string;
    latest: Latest | null;
    queued: boolean;
  }[];
  verdicts: ({ country: string } & IdeaVerdict)[];
}> {
  if (!idField.safeParse(id).success) {
    throw new UserError("Brainstorm not found");
  }
  const [b] = await db.select().from(brainstorms).where(eq(brainstorms.id, id));
  if (!b) throw new UserError("Brainstorm not found");

  const [found, latest, tops] = await Promise.all([
    b.keywordIds.length === 0
      ? []
      : db
          .select({
            id: keywords.id,
            country: keywords.country,
            phrase: keywords.phrase,
            queuedAt: keywords.queuedAt,
          })
          .from(keywords)
          .where(inArray(keywords.id, b.keywordIds)),
    latestChecks(b.keywordIds),
    latestTop(b.keywordIds),
  ]);
  const byId = new Map(found.map((k) => [k.id, k]));
  const rows = b.keywordIds.flatMap((keywordId) => {
    const k = byId.get(keywordId);
    if (!k) return [];
    return [
      {
        keywordId,
        country: k.country,
        phrase: k.phrase,
        latest: latest.get(keywordId) ?? null,
        queued: k.queuedAt !== null,
      },
    ];
  });
  return {
    id: b.id,
    idea: b.idea,
    countries: b.countries,
    platform: b.platform,
    createdAt: b.createdAt.toISOString(),
    rows,
    verdicts: b.countries.map((country) => ({
      country,
      ...ideaVerdict(
        rows
          .filter((r) => r.country === country)
          .map((r) => ({
            phrase: r.phrase,
            demand: r.latest?.volume ?? null,
            top: tops.get(r.keywordId) ?? [],
            queued: r.queued,
          })),
        b.platform,
      ),
    })),
  };
}

/** Queue a brainstorm's phrases not checked in the last hour, ahead of scheduled checks. Returns how many were queued. */
export async function recheckBrainstorm(id: number): Promise<number> {
  if (!idField.safeParse(id).success) {
    throw new UserError("Brainstorm not found");
  }
  const [b] = await db
    .select({ keywordIds: brainstorms.keywordIds })
    .from(brainstorms)
    .where(eq(brainstorms.id, id));
  if (!b) throw new UserError("Brainstorm not found");
  return enqueue(b.keywordIds, { maxAgeMs: HOUR_MS, priority: 0 });
}

/** Delete a brainstorm; its keywords and checks are kept. */
export async function deleteBrainstorm(id: number): Promise<void> {
  if (!idField.safeParse(id).success) {
    throw new UserError("Brainstorm not found");
  }
  const deleted = await db
    .delete(brainstorms)
    .where(eq(brainstorms.id, id))
    .returning({ id: brainstorms.id });
  if (deleted.length === 0) throw new UserError("Brainstorm not found");
}
