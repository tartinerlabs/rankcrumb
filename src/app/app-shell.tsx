"use client";

import { Button, IconPlus, IconSearch, Toast, Tooltip } from "@heroui/react";
import {
  AppLayout,
  Command,
  Navbar,
  Sidebar,
  useSidebar,
} from "@heroui-pro/react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, Suspense, use, useEffect, useState } from "react";
import { paletteKeywordsAction } from "@/actions/terms";
import { BulbIcon, ChartIcon, FileIcon } from "@/components/icons";
import type { PaletteKeyword } from "@/lib/terms";
import type { SidebarApp, SidebarBrainstorm } from "./_data/apps";

// Old pages stay reachable until release step 5
const oldPages = [
  { href: "/check", label: "Check", Icon: IconSearch },
  { href: "/tracking", label: "Tracking", Icon: ChartIcon },
  { href: "/ideas", label: "Ideas", Icon: BulbIcon },
  { href: "/listing", label: "Listing", Icon: FileIcon },
] as const;

type Data = {
  apps: Promise<SidebarApp[]>;
  brainstorms: Promise<SidebarBrainstorm[]>;
};

type Props = Data & { children: ReactNode };

export function AppShell({ apps, brainstorms, children }: Props) {
  const router = useRouter();
  const [isCommandOpen, setIsCommandOpen] = useState(false);

  // mod+K opens the command palette from anywhere
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The pathname read suspends while dynamic routes prerender, so it sits in
  // its own boundary; the fallback is the same menu with nothing marked current
  const nav = (
    <Suspense
      fallback={
        <SidebarNav apps={apps} brainstorms={brainstorms} pathname={null} />
      }
    >
      <CurrentSidebarNav apps={apps} brainstorms={brainstorms} />
    </Suspense>
  );

  return (
    <>
      <AppLayout
        navigate={router.push}
        sidebar={
          <>
            <Sidebar>
              {nav}
              <Sidebar.Rail />
            </Sidebar>
            <Sidebar.Mobile>{nav}</Sidebar.Mobile>
          </>
        }
        navbar={
          <Navbar maxWidth="full">
            <Navbar.Header>
              <Tooltip>
                <Sidebar.Trigger aria-label="Toggle sidebar" />
                <Tooltip.Content>Toggle sidebar</Tooltip.Content>
              </Tooltip>
              <Tooltip>
                <AppLayout.MenuToggle />
                <Tooltip.Content>Open navigation</Tooltip.Content>
              </Tooltip>
              <Tooltip>
                <Button
                  isIconOnly
                  variant="ghost"
                  aria-label="Search apps"
                  onPress={() => setIsCommandOpen(true)}
                >
                  <IconSearch />
                </Button>
                <Tooltip.Content>Search apps (⌘K)</Tooltip.Content>
              </Tooltip>
            </Navbar.Header>
          </Navbar>
        }
      >
        {children}
      </AppLayout>
      <CommandPalette
        apps={apps}
        brainstorms={brainstorms}
        isOpen={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        navigate={(href) => {
          setIsCommandOpen(false);
          router.push(href);
        }}
      />
      <Toast.Provider />
    </>
  );
}

function CurrentSidebarNav(props: Data) {
  const pathname = usePathname();
  return <SidebarNav {...props} pathname={pathname} />;
}

function SidebarNav({
  apps,
  brainstorms,
  pathname,
}: Data & { pathname: string | null }) {
  return (
    <>
      <Sidebar.Header>
        <span data-sidebar="label" className="px-2 text-base font-semibold">
          Rankcrumb
        </span>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.Menu aria-label="Create">
            <Sidebar.MenuItem
              id="new"
              href="/"
              textValue="New"
              isCurrent={pathname === "/"}
            >
              <Sidebar.MenuIcon>
                <IconPlus />
              </Sidebar.MenuIcon>
              <Sidebar.MenuLabel>New</Sidebar.MenuLabel>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.Group>

        <Sidebar.Group>
          <Sidebar.GroupLabel>Your Apps</Sidebar.GroupLabel>
          <Suspense fallback={null}>
            <AppsMenu apps={apps} pathname={pathname} />
          </Suspense>
        </Sidebar.Group>

        <Suspense fallback={null}>
          <BrainstormsGroup brainstorms={brainstorms} pathname={pathname} />
        </Suspense>

        <Sidebar.Group>
          <Sidebar.GroupLabel>Old Pages</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="Old pages">
            {oldPages.map(({ href, label, Icon }) => (
              <Sidebar.MenuItem
                key={href}
                id={href}
                href={href}
                textValue={label}
                isCurrent={pathname?.startsWith(href) ?? false}
              >
                <Sidebar.MenuIcon>
                  <Icon />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{label}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
    </>
  );
}

function AppsMenu({
  apps,
  pathname,
}: {
  apps: Promise<SidebarApp[]>;
  pathname: string | null;
}) {
  const list = use(apps);
  if (list.length === 0) {
    return <EmptyLine>Add your first app to start.</EmptyLine>;
  }
  return (
    <Sidebar.Menu aria-label="Your apps">
      {list.map((app) => {
        const base = `/apps/${app.trackId}`;
        return (
          <Sidebar.MenuItem
            key={app.trackId}
            id={app.trackId}
            href={`${base}/board`}
            textValue={app.name}
            isCurrent={
              pathname === base || (pathname?.startsWith(`${base}/`) ?? false)
            }
          >
            <Sidebar.MenuIcon>
              {/* biome-ignore lint/performance/noImgElement: tiny remote icon, no optimisation needed */}
              <img
                src={app.icon}
                alt=""
                width={20}
                height={20}
                className="size-5 rounded-md"
              />
            </Sidebar.MenuIcon>
            <Sidebar.MenuLabel>{app.name}</Sidebar.MenuLabel>
            {app.isMine && (
              <Sidebar.MenuChip>
                <span className="tabular-nums">{`${app.top10} in top 10`}</span>
              </Sidebar.MenuChip>
            )}
          </Sidebar.MenuItem>
        );
      })}
    </Sidebar.Menu>
  );
}

// Hidden while empty, so a first run shows a single line in the sidebar
function BrainstormsGroup({
  brainstorms,
  pathname,
}: {
  brainstorms: Promise<SidebarBrainstorm[]>;
  pathname: string | null;
}) {
  const list = use(brainstorms);
  if (list.length === 0) return null;
  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>Brainstorms</Sidebar.GroupLabel>
      <Sidebar.Menu aria-label="Brainstorms">
        {list.map((b) => {
          const href = `/brainstorms/${b.id}`;
          return (
            <Sidebar.MenuItem
              key={b.id}
              id={`brainstorm-${b.id}`}
              href={href}
              textValue={b.idea}
              isCurrent={pathname === href}
            >
              <Sidebar.MenuIcon>
                <BulbIcon />
              </Sidebar.MenuIcon>
              <Sidebar.MenuLabel>{b.idea}</Sidebar.MenuLabel>
            </Sidebar.MenuItem>
          );
        })}
      </Sidebar.Menu>
    </Sidebar.Group>
  );
}

// Hidden in the icon rail, like the group labels
function EmptyLine({ children }: { children: ReactNode }) {
  const { isMobile, isOpen } = useSidebar();
  if (!isOpen && !isMobile) return null;
  return <p className="px-2 text-xs text-muted">{children}</p>;
}

function CommandPalette({
  apps,
  brainstorms,
  isOpen,
  onOpenChange,
  navigate,
}: Data & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: (href: string) => void;
}) {
  const [keywords, setKeywords] = useState<PaletteKeyword[]>([]);

  // Keywords change on any tab, so read them each time the palette opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    paletteKeywordsAction().then((res) => {
      if (!cancelled && res.data) setKeywords(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return (
    <Command>
      <Command.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Command.Container>
          <Command.Dialog aria-label="Jump to an app or keyword">
            <Command.Header>
              <Command.InputGroup aria-label="Search apps, keywords and brainstorms">
                <Command.InputGroup.Prefix>
                  <IconSearch />
                </Command.InputGroup.Prefix>
                <Command.InputGroup.Input placeholder="Jump to an app, keyword or brainstorm" />
                <Command.InputGroup.ClearButton />
              </Command.InputGroup>
            </Command.Header>
            <Suspense fallback={null}>
              <CommandResults
                apps={apps}
                brainstorms={brainstorms}
                keywords={keywords}
                navigate={navigate}
              />
            </Suspense>
          </Command.Dialog>
        </Command.Container>
      </Command.Backdrop>
    </Command>
  );
}

function CommandResults({
  apps,
  brainstorms,
  keywords,
  navigate,
}: Data & {
  keywords: PaletteKeyword[];
  navigate: (href: string) => void;
}) {
  const appList = use(apps);
  const brainstormList = use(brainstorms);
  return (
    <Command.List
      aria-label="Results"
      renderEmptyState={() => "Nothing matches"}
      onAction={(key) => navigate(String(key))}
    >
      <Command.Group heading="Create">
        <Command.Item id="/" textValue="Add an app or brainstorm">
          Add an app or brainstorm
        </Command.Item>
      </Command.Group>
      {appList.length > 0 && (
        <Command.Group heading="Your Apps">
          {appList.map((app) => (
            <Command.Item
              key={app.trackId}
              id={`/apps/${app.trackId}/board`}
              textValue={app.name}
            >
              {/* biome-ignore lint/performance/noImgElement: tiny remote icon, no optimisation needed */}
              <img
                src={app.icon}
                alt=""
                width={20}
                height={20}
                className="size-5 rounded-md"
              />
              {app.name}
            </Command.Item>
          ))}
        </Command.Group>
      )}
      {keywords.length > 0 && (
        <Command.Group heading="Keywords">
          {keywords.map((k) => (
            <Command.Item
              key={k.termId}
              id={`/apps/${k.appId}/k/${k.termId}`}
              textValue={`${k.label} ${k.appName}`}
            >
              {k.label}
              <span className="text-muted">{k.appName}</span>
            </Command.Item>
          ))}
        </Command.Group>
      )}
      {brainstormList.length > 0 && (
        <Command.Group heading="Brainstorms">
          {brainstormList.map((b) => (
            <Command.Item
              key={b.id}
              id={`/brainstorms/${b.id}`}
              textValue={b.idea}
            >
              {b.idea}
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </Command.List>
  );
}
