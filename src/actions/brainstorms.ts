"use server";

import { act } from "@/actions/act";
import type { Platform } from "@/db/schema";
import { createBrainstorm, deleteBrainstorm } from "@/lib/brainstorms";

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
