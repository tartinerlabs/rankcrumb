import { asc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db";
import { apps } from "@/db/schema";
import {
  AscError,
  type AscListing,
  ascConfig,
  readListing,
  STOREFRONT_LOCALES,
} from "@/lib/asc";
import { lookup } from "@/lib/itunes";
import { ListingForm } from "./listing-form";

export const metadata: Metadata = { title: "Listing" };

// One AI call plus App Store Connect reads, or a draft save
export const maxDuration = 120;

const headClass =
  "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground";
const cellClass = "px-2 py-1.5 align-top";
const sectionHeadClass =
  "mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground";

export default function ListingPage(props: PageProps<"/listing">) {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-lg font-semibold tracking-tight">Listing</h1>
      <p className="mt-1 mb-6 text-muted-foreground">
        Rewrite your name, subtitle and keyword field around the keywords you
        track, see what they would cover, and save a draft to App Store Connect.
      </p>
      <Suspense
        fallback={
          <div className="h-40 animate-pulse rounded-card border border-border bg-card" />
        }
      >
        <ListingBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function ListingBody({
  searchParams,
}: Pick<PageProps<"/listing">, "searchParams">) {
  const { app: selectedId } = await searchParams;
  const mine = await db
    .select({ trackId: apps.trackId, name: apps.name, icon: apps.icon })
    .from(apps)
    .where(eq(apps.isMine, true))
    .orderBy(asc(apps.createdAt));
  const selected =
    mine.find((a) => String(a.trackId) === selectedId) ?? mine[0];

  if (!selected) {
    return (
      <div className="rounded-card border border-dashed border-border px-4 py-10 text-center">
        <p className="font-medium">No apps yet.</p>
        <p className="mt-1 text-muted-foreground">
          <Link href="/tracking" className="underline">
            Add your app and track keywords
          </Link>{" "}
          first; the listing is built from them.
        </p>
      </div>
    );
  }

  const { rows: storefronts } = await db.execute<{
    country: string;
    tracked: number;
  }>(sql`
    select k.country, count(*)::int as tracked
    from app_keywords ak join keywords k on k.id = ak.keyword_id
    where ak.app_id = ${selected.trackId}
    group by k.country
    order by count(*) desc, k.country`);

  const config = ascConfig();
  const [publicApp, ascResult] = await Promise.all([
    lookup(selected.trackId).catch(() => null),
    config
      ? readListing(config, selected.trackId).catch((e: unknown) => {
          console.error("listing readListing", e);
          return e instanceof AscError ? e.message : "request failed";
        })
      : null,
  ]);
  const ascListing = typeof ascResult === "object" ? ascResult : null;

  return (
    <>
      {mine.length > 1 && (
        <nav aria-label="Your apps" className="mb-6 flex flex-wrap gap-2">
          {mine.map((a) => {
            const current = a.trackId === selected.trackId;
            return (
              <Link
                key={a.trackId}
                href={`/listing?app=${a.trackId}`}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-8 items-center gap-2 rounded-control border px-2.5 ${current ? "border-primary bg-card font-medium" : "border-border hover:bg-muted"}`}
              >
                <span className="max-w-48 truncate">{a.name}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <section className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4">
        {/* biome-ignore lint/performance/noImgElement: tiny remote icon, no optimisation needed */}
        <img
          src={publicApp?.icon ?? selected.icon}
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {publicApp?.name ?? selected.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {publicApp
              ? "Public name on the US App Store"
              : "Saved name; the App Store lookup failed"}{" "}
            · <span className="font-mono">{selected.trackId}</span>
          </p>
        </div>
        <AscStatus configured={config !== null} result={ascResult} />
      </section>

      {ascListing && Object.keys(ascListing.locales).length > 0 && (
        <CurrentListing listing={ascListing} />
      )}

      {storefronts.length === 0 ? (
        <div className="rounded-card border border-dashed border-border px-4 py-10 text-center">
          <p className="font-medium">No tracked keywords yet.</p>
          <p className="mt-1 text-muted-foreground">
            <Link
              href={`/tracking?app=${selected.trackId}`}
              className="underline"
            >
              Track keywords
            </Link>{" "}
            for this app, then come back to build the listing.
          </p>
        </div>
      ) : (
        <ListingForm
          key={selected.trackId}
          appId={selected.trackId}
          storefronts={storefronts.map((s) => ({
            ...s,
            locale: STOREFRONT_LOCALES[s.country] ?? null,
          }))}
          asc={{
            configured: config !== null,
            editableVersion:
              ascListing?.editable && ascListing.version
                ? ascListing.version.versionString
                : null,
          }}
        />
      )}
    </>
  );
}

function AscStatus({
  configured,
  result,
}: {
  configured: boolean;
  result: AscListing | string | null;
}) {
  if (!configured) {
    return (
      <p className="text-xs text-muted-foreground">
        App Store Connect not connected
      </p>
    );
  }
  if (typeof result === "string") {
    return (
      <p role="alert" className="max-w-sm text-xs text-destructive">
        {result}
      </p>
    );
  }
  const version = result?.version;
  return (
    <p className="text-xs text-muted-foreground">
      App Store Connect ·{" "}
      {version ? (
        <>
          <span className="font-mono">{version.versionString}</span>{" "}
          {result?.editable
            ? "prepare for submission"
            : `${version.state.toLowerCase().replaceAll("_", " ")}; saving creates a new version`}
        </>
      ) : (
        "no versions yet"
      )}
    </p>
  );
}

function CurrentListing({ listing }: { listing: AscListing }) {
  return (
    <section className="mb-6">
      <h2 className={sectionHeadClass}>Current listing in App Store Connect</h2>
      <div className="relative overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={headClass}>Locale</th>
              <th className={headClass}>Name</th>
              <th className={headClass}>Subtitle</th>
              <th className={headClass}>Keyword field</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(listing.locales)
              .toSorted(([a], [b]) => a.localeCompare(b))
              .map(([locale, l]) => (
                <tr
                  key={locale}
                  className="border-b border-border last:border-0"
                >
                  <td className={`${cellClass} font-mono`}>{locale}</td>
                  <td className={cellClass}>{l.name || "–"}</td>
                  <td className={cellClass}>{l.subtitle || "–"}</td>
                  <td className={`${cellClass} font-mono text-xs break-all`}>
                    {l.keywords || "–"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
