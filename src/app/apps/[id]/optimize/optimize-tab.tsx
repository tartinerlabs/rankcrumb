import { EmptyState } from "@heroui-pro/react";
import { ASC_ENV, ascConfig, STOREFRONT_LOCALES } from "@/lib/asc";
import { loadListing } from "@/lib/listing";
import { loadBoard } from "@/lib/terms";
import { getWorkspaceApp } from "../data";
import { OptimizeEditor } from "./optimize-editor";
import {
  EMPTY_LISTING,
  type LocaleGroup,
  localeLabel,
  type Phrase,
} from "./score";

// Only rendered for your own apps
type Props = {
  appId: number;
  /** Storefront codes from the country bar, in display order */
  countries: string[];
};

// App Store Connect saves at most 5 locales at once, the main one included
const MAX_LOCALES = 5;

export async function OptimizeTab({ appId, countries }: Props) {
  const app = await getWorkspaceApp(String(appId));
  if (!app) return null;
  const [listing, board] = await Promise.all([
    loadListing(appId),
    loadBoard(appId),
  ]);

  // Visible phrases per storefront with their latest check, best value first like the AI prompt
  const byCountry = new Map<string, Phrase[]>();
  for (const term of board.terms) {
    if (term.hidden) continue;
    for (const [country, cell] of Object.entries(term.cells)) {
      if (cell.phrase === null) continue;
      const list = byCountry.get(country) ?? [];
      if (list.some((p) => p.phrase === cell.phrase)) continue;
      list.push({
        phrase: cell.phrase,
        volume: cell.latest?.volume ?? null,
        difficulty: cell.latest?.difficulty ?? null,
      });
      byCountry.set(country, list);
    }
  }
  const value = (p: Phrase) => (p.volume ?? 0) - (p.difficulty ?? 100) / 2;
  for (const list of byCountry.values()) {
    list.sort(
      (a, b) => value(b) - value(a) || a.phrase.localeCompare(b.phrase),
    );
  }

  // Storefronts sharing a locale are written together
  const groups = new Map<string, LocaleGroup>();
  const unsupported: string[] = [];
  for (const country of countries) {
    const locale = STOREFRONT_LOCALES[country];
    if (!locale) {
      unsupported.push(country);
      continue;
    }
    const group = groups.get(locale) ?? {
      locale,
      countries: [],
      country: null,
      phrases: [],
      current: listing.locales[locale] ?? EMPTY_LISTING,
    };
    group.countries.push(country);
    const phrases = byCountry.get(country) ?? [];
    if (!group.country && phrases.length > 0) group.country = country;
    for (const p of phrases) {
      if (!group.phrases.some((q) => q.phrase === p.phrase)) {
        group.phrases.push(p);
      }
    }
    groups.set(locale, group);
  }

  const main = groups.get(app.language) ?? {
    locale: app.language,
    countries: [],
    country: null,
    phrases: [],
    current: listing.locales[app.language] ?? {
      ...EMPTY_LISTING,
      name: app.name,
    },
  };
  if (!main.country) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>
            No Keywords in {localeLabel(app.language)}
          </EmptyState.Title>
          <EmptyState.Description>
            Options are built from the keywords you track in a country that uses
            your main listing language. Add that country and some keywords
            first.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  const others = [...groups.values()].filter((g) => g.locale !== main.locale);

  return (
    <OptimizeEditor
      appId={appId}
      main={{ ...main, country: main.country }}
      others={others.slice(0, MAX_LOCALES - 1)}
      dropped={others.slice(MAX_LOCALES - 1).map((g) => g.locale)}
      unsupported={unsupported}
      source={listing.source}
      version={
        listing.editable ? (listing.version?.versionString ?? null) : null
      }
      missingEnv={ascConfig() ? null : ASC_ENV}
    />
  );
}
