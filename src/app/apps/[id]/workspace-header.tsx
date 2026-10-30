import { Typography } from "@heroui/react";
import { notFound } from "next/navigation";
import { STOREFRONT_LOCALES } from "@/lib/asc";
import { CheckControls } from "./check-controls";
import { CountryBar } from "./country-bar";
import { getWorkspaceApp } from "./data";
import { HeaderActions } from "./header-actions";
import { WorkspaceTabs } from "./workspace-tabs";

const LANGUAGES = [...new Set(Object.values(STOREFRONT_LOCALES))];

function checkedAgo(at: Date): string {
  const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  return `Checked ${Math.floor(hours / 24)}d ago`;
}

export async function WorkspaceHeader({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getWorkspaceApp(id);
  if (!app) notFound();

  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {/* biome-ignore lint/performance/noImgElement: small remote App Store icon */}
        <img
          src={app.icon}
          alt=""
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <Typography.Heading level={1}>
            <span className="block truncate">{app.name}</span>
          </Typography.Heading>
          {app.subtitle && (
            <p className="truncate text-sm text-muted">{app.subtitle}</p>
          )}
        </div>
        <HeaderActions
          trackId={app.trackId}
          name={app.name}
          storefront={app.storefront}
          isMine={app.isMine}
          schedule={app.schedule}
          language={app.language}
          languages={LANGUAGES}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <WorkspaceTabs trackId={app.trackId} isMine={app.isMine} />
        </div>
        <CheckControls
          trackId={app.trackId}
          checkedText={app.lastCheckedAt ? checkedAgo(app.lastCheckedAt) : null}
        />
      </div>

      <CountryBar trackId={app.trackId} countries={app.countries} />
    </header>
  );
}
