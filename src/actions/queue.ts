"use server";

import { act } from "@/actions/act";
import { checkNow, kick, pauseChecks, resumeChecks } from "@/lib/queue";

/** Check an app's phrases now (all visible terms, or the given ones) unless checked in the last hour. */
export async function checkNowAction(appId: number, termIds?: number[]) {
  return act(() => checkNow(appId, termIds), true);
}

/** Pause while checks run: take the app's pending checks off the queue. Returns how many. */
export async function pauseChecksAction(appId: number) {
  return act(() => pauseChecks(appId), true);
}

/** After a run: expire the cached reads (header, sidebar) and refresh, as the worker may still be draining other apps. */
export async function refreshChecksAction() {
  return act(async () => undefined, true);
}

/**
 * With an app, queue its paused checks again (same as Check now). Without one,
 * start the worker again, e.g. after a rate-limit pause or a stall.
 */
export async function resumeAction(appId?: number) {
  if (appId === undefined) return act(() => kick());
  return act(() => resumeChecks(appId), true);
}
