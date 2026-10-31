export const TABS = ["board", "keywords", "track", "optimize"] as const;

export type Tab = (typeof TABS)[number];

export const TAB_LABELS: Record<Tab, string> = {
  board: "Board",
  keywords: "Keywords",
  track: "Track",
  optimize: "Optimize",
};

export function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

/** Optimize is only for your own apps. */
export function tabsFor(isMine: boolean): Tab[] {
  return isMine ? [...TABS] : TABS.filter((t) => t !== "optimize");
}
