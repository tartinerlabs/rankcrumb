"use server";

import { act } from "@/actions/act";
import type { Platform } from "@/db/schema";
import {
  createBrainstorm,
  deleteBrainstorm,
  recheckBrainstorm,
} from "@/lib/brainstorms";

/** Save a niche idea with AI keyword phrases and queue their checks. */
export async function createBrainstormAction(input: {
  idea: string;
  countries?: string[];
  platform?: Platform;
}) {
  return act(() => createBrainstorm(input), true);
}

export async function deleteBrainstormAction(id: number) {
  return act(() => deleteBrainstorm(id), true);
}

/** Check a brainstorm's phrases again (those not checked in the last hour). Returns how many were queued. */
export async function recheckBrainstormAction(id: number) {
  return act(() => recheckBrainstorm(id), true);
}
