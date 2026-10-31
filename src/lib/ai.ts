import "server-only";

import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
} from "ai";
import { z } from "zod";
import { UserError } from "@/lib/checks";
import { normalize } from "@/lib/scoring";

/** The one model every AI feature uses, routed through Vercel AI Gateway. */
export const MODEL = "openai/gpt-5.4-nano";

/** A short, user-facing message for an AI SDK or AI Gateway failure. */
export function describeAiError(error: unknown): string {
  const e = RetryError.isInstance(error) ? error.lastError : error;
  const type = e instanceof Error && "type" in e ? e.type : undefined;
  const message = e instanceof Error ? e.message : "";

  if (type === "authentication_error") {
    return "AI Gateway credentials are missing or expired. Locally, run `vercel env pull` to refresh VERCEL_OIDC_TOKEN, or set AI_GATEWAY_API_KEY.";
  }
  if (/free tier/i.test(message)) {
    return "This AI model needs paid AI Gateway credits on the Vercel team.";
  }
  if (
    type === "rate_limit_exceeded" ||
    (APICallError.isInstance(e) && e.statusCode === 429)
  ) {
    return "AI rate limit hit. Try again in a minute.";
  }
  if (type === "model_not_found") return `AI model ${MODEL} is not available.`;
  if (NoOutputGeneratedError.isInstance(e)) {
    return "The AI stopped before finishing. Try again.";
  }
  if (NoObjectGeneratedError.isInstance(e)) {
    return "The AI returned an invalid result. Try again.";
  }
  if (e instanceof DOMException && e.name === "TimeoutError") {
    return "The AI took too long. Try again.";
  }
  return "AI request failed.";
}

/** Storefronts where people search in English; they get the English label as is. */
export const ENGLISH_STOREFRONTS: ReadonlySet<string> = new Set([
  "us",
  "gb",
  "au",
  "ca",
  "nz",
  "ie",
  "sg",
  "in",
  "za",
  "ph",
]);

export function isEnglish(country: string): boolean {
  return ENGLISH_STOREFRONTS.has(country);
}

const MAX_LOCALIZE_PAIRS = 2000;
const LOCALIZE_CHUNK = 60;
const LOCALIZE_PARALLEL = 4;

const localizedSchema = z.object({
  results: z.array(
    z.object({
      label: z.string().describe("The English keyword, exactly as given"),
      country: z.string().describe("Storefront code, exactly as given"),
      phrase: z.string().describe("The native App Store search phrase"),
    }),
  ),
});

type Localized = { label: string; country: string; phrase: string };

/** One AI call for up to 60 pairs; keeps only requested pairs. */
async function localizeChunk(
  pairs: { label: string; country: string }[],
): Promise<Localized[]> {
  const { output } = await generateText({
    model: MODEL,
    instructions:
      "You are an App Store keyword researcher. For each English keyword and storefront, write the one phrase people in that storefront most likely type into App Store search for it, in the storefront's primary language and script. Prefer natural local wording over literal translation; keep the English keyword where locals search in English. Lowercase, 1 to 4 words, no brand names.",
    prompt: `Keyword and storefront pairs:\n${pairs.map((p) => `"${p.label}" ${p.country}`).join("\n")}\nReturn one entry per pair.`,
    output: Output.object({ schema: localizedSchema }),
    maxOutputTokens: 4000,
    timeout: 45_000,
  });

  const wanted = new Set(pairs.map((p) => `${p.label}:${p.country}`));
  const kept = new Map<string, Localized>();
  for (const r of output.results) {
    const label = normalize(r.label);
    const country = r.country.trim().toLowerCase();
    const phrase = normalize(r.phrase);
    const key = `${label}:${country}`;
    if (!wanted.has(key) || !phrase || phrase.length > 100) continue;
    kept.set(key, { label, country, phrase });
  }
  return [...kept.values()];
}

/**
 * One local phrase per English label and storefront. English storefronts get
 * the label with no AI call; the rest go to the AI in chunks of 60 pairs, 4 at
 * a time. A failed chunk leaves its pairs out, so callers can retry the gaps.
 * onChunk gets each chunk's phrases as it finishes, so a caller can save them
 * before a later chunk runs out of time.
 */
export async function localize(
  labels: string[],
  countries: string[],
  onChunk?: (results: Localized[]) => Promise<void>,
): Promise<Localized[]> {
  const parsed = z
    .object({
      labels: z.array(z.string().transform(normalize)),
      countries: z.array(
        z.string().regex(/^[a-z]{2}$/, "Storefront codes are two letters"),
      ),
    })
    .safeParse({ labels, countries });
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const uniqueLabels = [...new Set(parsed.data.labels.filter(Boolean))];
  const uniqueCountries = [...new Set(parsed.data.countries)];

  const out: Localized[] = [];
  const pending: { label: string; country: string }[] = [];
  for (const label of uniqueLabels) {
    for (const country of uniqueCountries) {
      if (isEnglish(country)) out.push({ label, country, phrase: label });
      else pending.push({ label, country });
    }
  }
  if (pending.length === 0) return out;
  if (pending.length > MAX_LOCALIZE_PAIRS) {
    throw new UserError(
      `That is ${pending.length} keyword and storefront pairs to translate. Translate at most ${MAX_LOCALIZE_PAIRS} at a time.`,
    );
  }

  const chunks: (typeof pending)[] = [];
  for (let i = 0; i < pending.length; i += LOCALIZE_CHUNK) {
    chunks.push(pending.slice(i, i + LOCALIZE_CHUNK));
  }
  let firstError: unknown;
  let localized = 0;
  // Up to 4 chunks in flight; each runner takes the next chunk when it finishes one
  let next = 0;
  const runner = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      let results: Localized[];
      try {
        results = await localizeChunk(chunk);
      } catch (e) {
        console.error("localize", e);
        firstError ??= e;
        continue;
      }
      localized += results.length;
      out.push(...results);
      await onChunk?.(results);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(LOCALIZE_PARALLEL, chunks.length) }, runner),
  );

  if (localized === 0) {
    throw new UserError(
      firstError === undefined
        ? "The AI returned no usable phrases. Try again."
        : describeAiError(firstError),
    );
  }
  return out;
}
