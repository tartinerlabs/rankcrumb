"use server";

import { act } from "@/actions/act";
import {
  importCandidates,
  proposeListing,
  saveListingDraft,
} from "@/lib/listing";

/** AI listing options per storefront; writes nothing. */
export async function proposeListingAction(appId: number, countries: string[]) {
  return act(() => proposeListing(appId, countries));
}

/** Save the listing to an App Store Connect draft version (never submitted). Needs confirmed: true. */
export async function saveListingDraftAction(
  input: Parameters<typeof saveListingDraft>[0],
) {
  return act(() => saveListingDraft(input), true);
}

/** Listing words that are not keywords yet. */
export async function importCandidatesAction(appId: number) {
  return act(() => importCandidates(appId));
}
