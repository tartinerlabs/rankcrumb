import { Skeleton, Typography } from "@heroui/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSidebarApps } from "@/app/data/apps";
import { getBrainstorm } from "@/lib/brainstorms";
import { UserError } from "@/lib/checks";
import {
  BrainstormNext,
  type BrainstormRow,
  BrainstormTable,
  IdeaVerdicts,
} from "./brainstorm-table";

const TITLE_MAX = 80;

/** The idea's first sentence as the page heading, cut at a word. */
function ideaTitle(idea: string) {
  const first = idea.trim().split(/(?<=[.!?])\s/)[0] ?? idea;
  if (first.length <= TITLE_MAX) return first.replace(/[.!?]$/, "");
  const boundary = first.lastIndexOf(" ", TITLE_MAX);
  return `${first.slice(0, boundary > 0 ? boundary : TITLE_MAX)}…`;
}

export const metadata: Metadata = { title: "Brainstorm" };

export default function BrainstormPage({
  params,
}: PageProps<"/brainstorms/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-8">
      <Suspense
        fallback={
          <div className="flex flex-col gap-6">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <BrainstormContent params={params} />
      </Suspense>
    </div>
  );
}

async function BrainstormContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  let brainstorm: Awaited<ReturnType<typeof getBrainstorm>>;
  try {
    brainstorm = await getBrainstorm(Number(id));
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }

  const apps = (await getSidebarApps()).filter((a) => a.isMine);
  const title = ideaTitle(brainstorm.idea);

  const rows: BrainstormRow[] = brainstorm.rows.map((r) => ({
    keywordId: r.keywordId,
    country: r.country,
    phrase: r.phrase,
    volume: r.latest?.volume ?? null,
    difficulty: r.latest?.difficulty ?? null,
    checked: r.latest !== null,
    queued: r.queued,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Typography.Heading level={1}>{title}</Typography.Heading>
      {title !== brainstorm.idea.trim() && (
        <Typography.Paragraph color="muted">
          {brainstorm.idea}
        </Typography.Paragraph>
      )}
      {brainstorm.platform === "mac" && (
        <p className="text-sm text-muted">
          Checked against the Mac App Store. Apple publishes no Mac ratings, so
          Competition comes from how often top apps get reviews and how long
          they have been around.
        </p>
      )}
      <IdeaVerdicts
        brainstormId={brainstorm.id}
        verdicts={brainstorm.verdicts}
      />
      <BrainstormTable rows={rows} />
      <BrainstormNext
        keywords={rows.map(({ keywordId, phrase }) => ({ keywordId, phrase }))}
        apps={apps.map(({ trackId, name }) => ({ trackId, name }))}
      />
    </div>
  );
}
