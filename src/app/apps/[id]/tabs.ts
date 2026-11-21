export const TABS = ["board", "keywords", "track", "optimize"] as const;

export type Tab = (typeof TABS)[number];

// Labels say the job; the URL slugs stay as they are
export const TAB_LABELS: Record<Tab, string> = {
  board: "Overview",
  keywords: "Keywords",
  track: "Rankings",
  optimize: "Listing",
};

/** One line under the tab bar that says what the tab is for. */
export function tabHelp(tab: Tab, isMine: boolean): string {
  switch (tab) {
    case "board":
      return "Each keyword in each country: rank, D = Demand and C = Competition. Click a cell to see its rank history.";
    case "keywords":
      return "Add, translate, hide or delete the keywords that RankCrumb checks.";
    case "track":
      return isMine
        ? "Where you rank in each country, what to do next, and which apps are ahead of you."
        : "Where this app ranks in each country and which apps are ahead of it.";
    case "optimize":
      return "Write a new App Store listing from your keywords, then save it to App Store Connect.";
  }
}

export function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

/** Optimize is only for your own apps. */
export function tabsFor(isMine: boolean): Tab[] {
  return isMine ? [...TABS] : TABS.filter((t) => t !== "optimize");
}
