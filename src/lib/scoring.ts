import type { TopApp } from "@/db/schema";

// Pure scoring over stored TopApp results (rank order, index 0 = rank 1).

const STOPWORDS = new Set([
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

/** open below 35, contested 35-69, crowded 70 and above. */
export function difficultyLabel(
  difficulty: number,
): "open" | "contested" | "crowded" {
  if (difficulty < 35) return "open";
  if (difficulty < 70) return "contested";
  return "crowded";
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
 * rank 10 or better keep; volume under 10 skip; rank 11-50 with volume 30+
 * push; unranked with volume 30+ and difficulty under 70 try; volume 30+ and
 * difficulty 70+ long-shot. Otherwise null (no rule applies).
 */
export function nextStep(
  rank: number | null,
  volume: number,
  difficulty: number,
): NextStep | null {
  if (rank !== null && rank <= 10) return "keep";
  if (volume < 10) return "skip";
  if (rank !== null && rank <= 50 && volume >= 30) return "push";
  if (rank === null && volume >= 30 && difficulty < 70) return "try";
  if (volume >= 30 && difficulty >= 70) return "long-shot";
  return null;
}
