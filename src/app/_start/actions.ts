"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { act } from "@/actions/act";
import { addApp as addWorkspace } from "@/lib/apps";
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

/** Saves the picked app as a workspace through the shared addApp, then opens it. */
export async function addApp(
  id: number,
  country: string,
  isMine: boolean,
): Promise<{ error: string }> {
  const res = await act(() => addWorkspace({ id, country, mine: isMine }));
  if (res.error !== undefined) return { error: res.error };

  revalidatePath("/", "layout");
  // TODO(UI): send res.data.needsCountries to the countries step once it exists
  redirect(`/apps/${res.data.app.id}/board`);
}
