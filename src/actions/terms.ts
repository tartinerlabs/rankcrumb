"use server";

import { act } from "@/actions/act";
import {
  type AddTermsInput,
  addTerms,
  deleteTerms,
  localizeMissing,
  restoreTerms,
  setCountries,
  setHidden,
  setPhrase,
  trackPhrases,
} from "@/lib/terms";

export async function setCountriesAction(appId: number, countries: string[]) {
  return act(() => setCountries(appId, countries), true);
}

/** Retry translation: fill phrases missing after a failed AI run. */
export async function localizeMissingAction(appId: number, termIds?: number[]) {
  return act(() => localizeMissing(appId, termIds), true);
}

export async function addTermsAction(appId: number, input: AddTermsInput) {
  return act(() => addTerms(appId, input), true);
}

export async function trackPhrasesAction(
  appId: number,
  input: { keywordIds: number[]; localize: boolean },
) {
  return act(() => trackPhrases(appId, input), true);
}

export async function setPhraseAction(
  appId: number,
  termId: number,
  country: string,
  phrase: string | null,
) {
  return act(() => setPhrase(appId, termId, country, phrase), true);
}

export async function setHiddenAction(
  appId: number,
  termIds: number[],
  hidden: boolean,
) {
  return act(() => setHidden(appId, termIds, hidden), true);
}

export async function deleteTermsAction(appId: number, termIds: number[]) {
  return act(() => deleteTerms(appId, termIds), true);
}

export async function restoreTermsAction(appId: number, termIds: number[]) {
  return act(() => restoreTerms(appId, termIds), true);
}
