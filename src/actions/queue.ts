"use server";

import { act } from "@/actions/act";
import { checkNow, kick } from "@/lib/queue";

/** Check an app's phrases now (all visible terms, or the given ones) unless checked in the last hour. */
export async function checkNowAction(appId: number, termIds?: number[]) {
  return act(() => checkNow(appId, termIds), true);
}

/** Start the worker again, e.g. after a pause or a stall. */
export async function resumeAction() {
  return act(() => kick());
}
