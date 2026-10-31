"use server";

import {
  type AppInfo,
  findApps,
  InvalidStorefrontError,
  lookup,
  parseAppLink,
  ThrottledError,
} from "@/lib/itunes";

export type SearchResult = { apps: AppInfo[]; error?: string };

// Typeahead waits at most a few seconds for a gate slot instead of the full 30
const SEARCH_DEADLINE_MS = 15_000;

/** Apps for the start screen search: an App Store link or ID, else a name in the US store. */
export async function searchApps(text: string): Promise<SearchResult> {
  const term = text.trim().slice(0, 200);
  const opts = { deadline: Date.now() + SEARCH_DEADLINE_MS };
  try {
    const link = parseAppLink(term);
    if (link) {
      const app = await lookup(link.id, link.country, opts);
      return app
        ? { apps: [app] }
        : { apps: [], error: "No app with that link on the App Store" };
    }
    if (term.length < 2) return { apps: [] };
    return { apps: await findApps(term, "us", opts) };
  } catch (e) {
    if (e instanceof ThrottledError) {
      return { apps: [], error: "The App Store is busy. Try again shortly." };
    }
    if (e instanceof InvalidStorefrontError) {
      return { apps: [], error: "That link names an unknown storefront" };
    }
    console.error("searchApps", e);
    return { apps: [], error: "App Store search failed" };
  }
}
