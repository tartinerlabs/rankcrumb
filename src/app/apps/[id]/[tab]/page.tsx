import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BoardTab } from "../board/board-tab";
import { KeywordsTab } from "../keywords/keywords-tab";
import { OptimizeTab } from "../optimize/optimize-tab";
import { TrackTab } from "../track/track-tab";
import { getWorkspaceApp } from "../data";
import { isTab } from "../tabs";

// Localize (Keywords) and listing proposals (Optimize) are AI server actions on this page
export const maxDuration = 120;

export default function AppTabPage({ params }: PageProps<"/apps/[id]/[tab]">) {
  return (
    <Suspense fallback={null}>
      <TabContent params={params} />
    </Suspense>
  );
}

async function TabContent({
  params,
}: {
  params: Promise<{ id: string; tab: string }>;
}) {
  const { id, tab } = await params;
  if (!isTab(tab)) notFound();
  const app = await getWorkspaceApp(id);
  if (!app || (tab === "optimize" && !app.isMine)) notFound();

  const { trackId: appId, isMine, countries } = app;
  switch (tab) {
    case "board":
      return <BoardTab appId={appId} isMine={isMine} countries={countries} />;
    case "keywords":
      return (
        <KeywordsTab appId={appId} isMine={isMine} countries={countries} />
      );
    case "track":
      return <TrackTab appId={appId} isMine={isMine} countries={countries} />;
    case "optimize":
      return <OptimizeTab appId={appId} countries={countries} />;
  }
}
