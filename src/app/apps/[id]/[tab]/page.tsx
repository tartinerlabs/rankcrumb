import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getWorkspaceApp } from "../data";
import { isTab } from "../tabs";
import { TabEmptyState } from "./tab-empty-state";

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
  return <TabEmptyState tab={tab} />;
}
