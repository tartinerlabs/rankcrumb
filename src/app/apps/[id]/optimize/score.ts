import type { ListingText } from "@/db/schema";
import { isCovered, normalize } from "@/lib/scoring";

// Client-side mirror of the listing scoring in src/lib/listing.ts, so edits rescore live

export const NAME_MAX = 30;
export const SUBTITLE_MAX = 30;
export const KEYWORDS_MAX = 100;
export const PROMO_MAX = 170;
export const DESCRIPTION_MAX = 4000;

export type Phrase = {
  phrase: string;
  volume: number | null;
  difficulty: number | null;
};

/** One App Store locale and the storefronts that share it. */
export type LocaleGroup = {
  locale: string;
  countries: string[];
  /** Storefront sent to the AI: the first one with tracked phrases, else null */
  country: string | null;
  /** Visible tracked phrases across its storefronts, best value first */
  phrases: Phrase[];
  current: ListingText;
};

export type Score = {
  /** Sum of the latest volume of the covered phrases */
  reach: number;
  /** Average latest difficulty of the covered phrases; null when none is checked */
  difficulty: number | null;
  covered: Phrase[];
};

export const EMPTY_LISTING: ListingText = {
  name: "",
  subtitle: "",
  keywords: "",
};

export function score(listing: ListingText, phrases: Phrase[]): Score {
  const text = `${listing.name} ${listing.subtitle} ${listing.keywords}`;
  const covered = phrases.filter((p) => isCovered(p.phrase, text));
  const checked = covered.filter((p) => p.difficulty !== null);
  return {
    reach: covered.reduce((sum, p) => sum + (p.volume ?? 0), 0),
    difficulty:
      checked.length === 0
        ? null
        : Math.round(
            checked.reduce((sum, p) => sum + (p.difficulty ?? 0), 0) /
              checked.length,
          ),
    covered,
  };
}

/**
 * Covered phrases split by the field that earns them: the name first, then the
 * subtitle, then the keyword field for phrases that need it (alone or combined).
 */
export function coverageByField(listing: ListingText, phrases: Phrase[]) {
  const all = score(listing, phrases).covered;
  const name = all.filter((p) => isCovered(p.phrase, listing.name));
  const subtitle = all.filter(
    (p) => !name.includes(p) && isCovered(p.phrase, listing.subtitle),
  );
  const keywords = all.filter(
    (p) => !name.includes(p) && !subtitle.includes(p),
  );
  return { name, subtitle, keywords };
}

/** Error for a keyword field, or undefined when it follows Apple's rules. */
export function keywordFieldError(listing: ListingText): string | undefined {
  if (/\s/.test(listing.keywords)) {
    return "Use commas between words, no spaces";
  }
  const used = new Set(
    normalize(`${listing.name} ${listing.subtitle}`).split(" "),
  );
  const repeated = normalize(listing.keywords)
    .split(" ")
    .filter((w) => w && used.has(w));
  if (repeated.length > 0) {
    return `Already in the name or subtitle: ${[...new Set(repeated)].join(", ")}`;
  }
  return undefined;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function localeLabel(locale: string): string {
  try {
    return languageNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** Title Case for short option names. */
export function titleCase(s: string): string {
  return s.replace(/(^|\s)(\p{L})/gu, (_, space, c) => space + c.toUpperCase());
}
