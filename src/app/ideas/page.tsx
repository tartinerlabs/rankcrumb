import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { IdeasForm } from "./ideas-form";

export const metadata: Metadata = { title: "Ideas" };

// One AI call, or up to 15 Apple searches in sequence
export const maxDuration = 120;

export default function IdeasPage() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-lg font-semibold tracking-tight">Ideas</h1>
      <p className="mt-1 mb-6 text-muted-foreground">
        Describe an app and get candidate keywords for each storefront, written
        in its language. Pick the promising ones to check or track.
      </p>
      <Suspense
        fallback={
          <div className="h-56 animate-pulse rounded-card border border-border bg-card" />
        }
      >
        <Ideas />
      </Suspense>
    </div>
  );
}

async function Ideas() {
  const mine = await db
    .select({ trackId: apps.trackId, name: apps.name })
    .from(apps)
    .where(eq(apps.isMine, true))
    .orderBy(asc(apps.createdAt));
  return <IdeasForm apps={mine} />;
}
