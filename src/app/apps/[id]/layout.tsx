import { Skeleton } from "@heroui/react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getWorkspaceApp } from "./data";
import { WorkspaceHeader } from "./workspace-header";

export async function generateMetadata({
  params,
}: LayoutProps<"/apps/[id]">): Promise<Metadata> {
  const { id } = await params;
  const app = await getWorkspaceApp(id);
  return { title: app?.name ?? "App" };
}

// Not async: params are awaited inside the Suspense boundary so the shell prerenders
export default function AppWorkspaceLayout({
  children,
  params,
}: LayoutProps<"/apps/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-8">
      <Suspense fallback={<HeaderFallback />}>
        <WorkspaceHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

function HeaderFallback() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-9 w-80 max-w-full" />
    </div>
  );
}
