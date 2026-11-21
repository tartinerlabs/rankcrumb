import type { TopApp } from "@/db/schema";

// Pure scoring over stored TopApp results (rank order, index 0 = rank 1).

export const STOPWORDS = new Set([
  // en
  "a",
  "an",
  "and",
  "the",
  "for",
  "of",
  "to",
  "in",
  "on",
  "with",
  "by",
  "my",
  "your",
  "app",
  // de / fr / es
  "und",
  "der",
  "die",
  "das",
  "für",
  "mit",
  "von",
  "et",
  "le",
  "la",
  "les",
  "de",
  "pour",
  "y",
  "el",
  "para",
  "con",
]);

/** Lowercase, Unicode-normalise, keep letters, marks and digits (any script), collapse to single spaces. Keeps diacritics. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

function tokenize(s: string): string[] {
  const toks = normalize(s).split(" ").filter(Boolean);
  const content = toks.filter((t) => !STOPWORDS.has(t));
  return content.length > 0 ? content : toks;
}

/** Light stemming so tracker/tracking/trackers match. */
function tokenMatches(
  phraseTok: string,
  titleToks: string[],
  titleCompact: string,
): boolean {
  if (titleToks.includes(phraseTok)) return true;
  if (phraseTok.length >= 5) {
    const stem = phraseTok.slice(0, Math.max(4, phraseTok.length - 3));
    if (titleToks.some((t) => t.startsWith(stem))) return true;
  }
  // compound words (de: "kalorienzähler" inside "KI-Kalorienzähler")
  return phraseTok.length >= 6 && titleCompact.includes(phraseTok);
}

/**
 * How strongly one title targets the phrase, 0..1.
 * 1.0 = whole phrase present in order (spaces/punctuation ignored)
 * 0.85 = all content tokens present but not contiguous
 * else = (share of content tokens present)^2 * 0.7
 */
function titleMatch(phrase: string, title: string): number {
  const p = normalize(phrase);
  const t = normalize(title);
  if (!p || !t) return 0;
  const pCompact = p.replaceAll(" ", "");
  const tCompact = t.replaceAll(" ", "");
  if (` ${t} `.includes(` ${p} `) || tCompact.includes(pCompact)) return 1;
  const pToks = tokenize(phrase);
  const tToks = t.split(" ");
  const hit = pToks.filter((tok) => tokenMatches(tok, tToks, tCompact)).length;
  const share = hit / pToks.length;
  return share === 1 ? 0.85 : share * share * 0.7;
}

/** DCG-style position weight, rank is 1-based. */
const posWeight = (rank: number) => 1 / Math.log2(rank + 1);

/** 1-based position of appId in the results, or null when absent. */
export function rankOf(
  results: Pick<TopApp, "id">[],
  appId: number,
): number | null {
  const i = results.findIndex((r) => r.id === appId);
  return i === -1 ? null : i + 1;
}

/**
 * Volume 0-100: how strongly the top-50 results target the phrase in their
 * title (position-weighted). NOT Apple search popularity. Result count is
 * never used because Apple returns ~190 fuzzy results even for nonsense.
 */
export function volumeScore(
  phrase: string,
  results: Pick<TopApp, "name">[],
  topN = 50,
): number {
  const top = results.slice(0, topN);
  if (top.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < topN; i++) {
    const w = posWeight(i + 1);
    den += w; // missing slots count as 0 so thin result sets score low
    if (i < top.length) num += w * titleMatch(phrase, top[i].name);
  }
  return Math.round((100 * num) / den);
}

/** Where App Store autocomplete first suggests a phrase: characters typed and its 1-based place among the suggestions. */
export type HintHit = { typed: number; position: number };

/**
 * Demand 0-100 from App Store autocomplete: the fewer characters typed before
 * Apple suggests the phrase, and the higher it sits, the more it is searched.
 * 80% characters (3 or fewer = full, 15 or more = none), 20% place (1st = full,
 * 10th = a tenth). Never suggested = 0. Relative, not a search count.
 */
export function popularityScore(hit: HintHit | null): number {
  if (!hit) return 0;
  const typed = Math.min(1, Math.max(0, (15 - hit.typed) / 12));
  const place = Math.min(1, Math.max(0, (11 - hit.position) / 10));
  return Math.round(100 * (0.8 * typed + 0.2 * place));
}

/** log10 rating count mapped to 0..1: <=10 ratings -> 0, >=1,000,000 -> 1. */
const ratingStrength = (count: number) =>
  Math.min(1, Math.max(0, (Math.log10(1 + count) - 1) / 5));

/**
 * Difficulty 0-100 from the top-10: 85% position-weighted log rating count
 * (scaled by how strongly each app targets the phrase), 15% position-weighted
 * average rating (only apps with ratings; (avg-3)/2 clamped, scaled by strength).
 */
export function difficultyScore(
  phrase: string,
  results: Pick<TopApp, "name" | "ratings" | "avg">[],
  topN = 10,
): number {
  const top = results.slice(0, topN);
  if (top.length === 0) return 0;
  let sNum = 0;
  let sDen = 0;
  let qNum = 0;
  let qDen = 0;
  for (let i = 0; i < topN; i++) {
    const w = posWeight(i + 1);
    sDen += w;
    const r = top[i];
    if (!r) continue;
    // An incumbent only blocks as much as it targets the phrase:
    // exact-title apps count fully, unrelated fuzzy matches count 30%.
    const relevance = 0.3 + 0.7 * titleMatch(phrase, r.name);
    sNum += w * relevance * ratingStrength(r.ratings);
    if (r.ratings > 0) {
      qNum += w * Math.min(1, Math.max(0, (r.avg - 3) / 2));
      qDen += w;
    }
  }
  const strength = sNum / sDen;
  const quality = qDen > 0 ? qNum / qDen : 0;
  return Math.round(
    100 * (0.85 * strength + 0.15 * quality * Math.min(1, strength / 0.5)),
  );
}

const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Whether listing text (name, subtitle and keyword field together) contains
 * every content word of the phrase. Words written without spaces (Chinese,
 * Japanese, Korean) also count when they appear inside a longer run.
 */
export function isCovered(phrase: string, listing: string): boolean {
  const text = normalize(listing);
  const words = new Set(text.split(" "));
  const compact = text.replaceAll(" ", "");
  return tokenize(phrase).every(
    (t) => words.has(t) || (CJK.test(t) && compact.includes(t)),
  );
}

export type NextStep = "keep" | "push" | "try" | "long-shot" | "skip";

/**
 * Suggested next step for a tracked phrase, first rule that matches:
 * rank 10 or better keep; demand (volume) unknown null; volume under 10 skip; rank 11-50 with volume 30+
 * push; unranked with volume 30+ and difficulty under 70 try; volume 30+ and
 * difficulty 70+ long-shot. Otherwise null (no rule applies).
 */
export function nextStep(
  rank: number | null,
  volume: number | null,
  difficulty: number,
): NextStep | null {
  if (rank !== null && rank <= 10) return "keep";
  // Demand not measured: no basis for the other rules
  if (volume === null) return null;
  if (volume < 10) return "skip";
  if (rank !== null && rank <= 50 && volume >= 30) return "push";
  if (rank === null && volume >= 30 && difficulty < 70) return "try";
  if (volume >= 30 && difficulty >= 70) return "long-shot";
  return null;
}

export type Verdict =
  | "worth-building"
  | "worth-a-look"
  | "tough-market"
  | "little-demand"
  | "checking"
  | "unknown";

/** One phrase of an idea in one storefront: latest Demand and Competition and its top 10, null scores when not checked. */
export type IdeaPhrase = {
  phrase: string;
  demand: number | null;
  competition: number | null;
  top: TopApp[];
  queued: boolean;
};

export type IdeaVerdict = {
  verdict: Verdict;
  /** Plain sentences behind the verdict, in display order */
  reasons: string[];
  /** Phrases with Demand 50+ and an app named for them in the top 10, highest first */
  searched: { phrase: string; demand: number }[];
  /** Apps named for a searched phrase in its top 10, most phrases first, at most 5 */
  competitors: { app: TopApp; phrases: number }[];
};

const SEARCHED = 50;
const MIN_SEARCHED = 3;
const NEWCOMER_DAYS = 730;
const NEWCOMER_RATINGS = 1000;
const STALE_DAYS = 365;
const WEAK_AVG = 4;
const WEAK_MIN_RATINGS = 100;
// Every word of the phrase is in the app's name (titleMatch 0.85+)
const RELEVANT = 0.85;
// Typical ratings of the named apps below this = small market
const SMALL_MARKET = 100;
const DAY_MS = 86_400_000;

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Whether an app idea is worth building in one storefront, by rules over its
 * phrases (first that matches): checks still running = checking; no Demand
 * measured = unknown. A phrase counts as searched with Demand 50+ and an app
 * named for it in its top 10 (else people searching it want something else);
 * under 3 searched phrases = little demand. Then over the apps named for the
 * searched phrases: Competition 70+ and no opening = tough market; Competition
 * under 60, 2+ openings and a typical 100+ ratings = worth building; else worth
 * a look. An opening is a newcomer (released in the last 2 years, 1,000+
 * ratings) or a weak leader (under 4.0 stars with 100+ ratings, or not updated
 * in a year).
 */
export function ideaVerdict(
  phrases: IdeaPhrase[],
  now = Date.now(),
): IdeaVerdict {
  const empty = { searched: [], competitors: [] };
  if (phrases.some((p) => p.queued)) {
    return {
      verdict: "checking",
      reasons: [
        `${count(phrases.filter((p) => p.queued).length, "phrase")} still being checked.`,
      ],
      ...empty,
    };
  }
  const measured = phrases.filter((p) => p.demand !== null);
  if (measured.length === 0) {
    return {
      verdict: "unknown",
      reasons: ["Demand is not measured for this storefront."],
      ...empty,
    };
  }

  const named = (p: IdeaPhrase) =>
    p.top.slice(0, 10).filter((a) => titleMatch(p.phrase, a.name) >= RELEVANT);
  const popular = measured
    .filter((p) => (p.demand as number) >= SEARCHED)
    .toSorted((a, b) => (b.demand as number) - (a.demand as number));
  const searchedPhrases = popular.filter((p) => named(p).length > 0);
  const offTarget = popular.filter((p) => named(p).length === 0);
  const searched = searchedPhrases.map((p) => ({
    phrase: p.phrase,
    demand: p.demand as number,
  }));
  const demandReason = `${searched.length} of ${count(measured.length, "phrase")} ${searched.length === 1 ? "has" : "have"} Demand ${SEARCHED} or more and apps named for ${searched.length === 1 ? "it" : "them"}.`;
  const offTargetReason =
    offTarget.length > 0 &&
    `${offTarget.map((p) => `"${p.phrase}"`).join(", ")} ${offTarget.length === 1 ? "is" : "are"} searched, but no app in the top 10 is named for ${offTarget.length === 1 ? "it" : "them"}, so people may want something else.`;
  if (searched.length < MIN_SEARCHED) {
    return {
      verdict: "little-demand",
      reasons: [
        demandReason,
        offTargetReason,
        "Few people search for apps like this.",
      ].filter((r): r is string => typeof r === "string"),
      searched,
      competitors: [],
    };
  }

  // Each app named for a searched phrase once, counted by how many it leads
  const leaders = new Map<number, { app: TopApp; phrases: number }>();
  for (const p of searchedPhrases) {
    for (const app of named(p)) {
      const seen = leaders.get(app.id);
      if (seen) seen.phrases++;
      else leaders.set(app.id, { app, phrases: 1 });
    }
  }
  const apps = [...leaders.values()].map((l) => l.app);
  const daysAgo = (day: string) => (now - Date.parse(day)) / DAY_MS;
  const newcomers = apps.filter(
    (a) =>
      a.released !== undefined &&
      daysAgo(a.released) <= NEWCOMER_DAYS &&
      a.ratings >= NEWCOMER_RATINGS,
  );
  const lowRated = apps.filter(
    (a) => a.ratings >= WEAK_MIN_RATINGS && a.avg < WEAK_AVG,
  );
  const stale = apps.filter(
    (a) => a.updated !== undefined && daysAgo(a.updated) > STALE_DAYS,
  );
  const openings = new Set(
    [...newcomers, ...lowRated, ...stale].map((a) => a.id),
  ).size;
  const datesKnown = apps.some((a) => a.released !== undefined);

  const scored = searchedPhrases.filter((p) => p.competition !== null);
  const competition =
    scored.length === 0
      ? null
      : Math.round(
          scored.reduce((sum, p) => sum + (p.competition as number), 0) /
            scored.length,
        );
  const typical = median(apps.map((a) => a.ratings));

  const verdict: Verdict =
    competition !== null && competition >= 70 && openings === 0
      ? "tough-market"
      : competition !== null &&
          competition < 60 &&
          openings >= 2 &&
          typical !== null &&
          typical >= SMALL_MARKET
        ? "worth-building"
        : "worth-a-look";

  const reasons = [
    demandReason,
    offTargetReason,
    competition !== null &&
      `Average Competition of these phrases is ${competition}.`,
    typical !== null &&
      (typical < SMALL_MARKET
        ? `The apps named for these phrases have a typical ${count(typical, "rating")}, a small market.`
        : `The apps named for these phrases have a typical ${count(typical, "rating")}.`),
    datesKnown &&
      (newcomers.length > 0
        ? `${count(newcomers.length, "newcomer")} in the top 10: released in the last 2 years, with ${NEWCOMER_RATINGS.toLocaleString("en")} or more ratings.`
        : "No app released in the last 2 years has 1,000 or more ratings."),
    lowRated.length > 0 &&
      `${count(lowRated.length, "leading app")} ${lowRated.length === 1 ? "is" : "are"} rated under ${WEAK_AVG.toFixed(1)} stars.`,
    datesKnown &&
      stale.length > 0 &&
      `${count(stale.length, "leading app")} ${stale.length === 1 ? "is" : "are"} not updated in more than a year.`,
    !datesKnown &&
      "Release and update dates are not known yet. Check again to get them.",
  ].filter((r): r is string => typeof r === "string");

  return {
    verdict,
    reasons,
    searched,
    competitors: [...leaders.values()]
      .toSorted(
        (a, b) => b.phrases - a.phrases || b.app.ratings - a.app.ratings,
      )
      .slice(0, 5),
  };
}
