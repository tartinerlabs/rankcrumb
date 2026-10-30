"use server";

import { act } from "@/actions/act";
import type { Schedule } from "@/db/schema";
import {
  addApp,
  addCompetitor,
  removeApp,
  removeCompetitor,
  searchApps,
  updateApp,
} from "@/lib/apps";

export async function searchAppsAction(query: string) {
  return act(() => searchApps(query));
}

export async function addAppAction(input: {
  id: number;
  country: string;
  mine: boolean;
}) {
  return act(() => addApp(input), true);
}

export async function updateAppAction(
  appId: number,
  patch: { schedule?: Schedule; language?: string; mine?: boolean },
) {
  return act(() => updateApp(appId, patch), true);
}

export async function removeAppAction(appId: number) {
  return act(() => removeApp(appId), true);
}

export async function addCompetitorAction(
  appId: number,
  competitor: { id: number; country?: string },
) {
  return act(() => addCompetitor(appId, competitor), true);
}

export async function removeCompetitorAction(
  appId: number,
  competitorId: number,
) {
  return act(() => removeCompetitor(appId, competitorId), true);
}
