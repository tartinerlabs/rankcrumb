import { Skeleton, Typography } from "@heroui/react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getBrainstorm } from "@/lib/brainstorms";
import { UserError } from "@/lib/checks";
import { type BrainstormRow, BrainstormTable } from "./brainstorm-table";

export const metadata: Metadata = { title: "Brainstorm" };

export default function BrainstormPage({
  params,
}: PageProps<"/brainstorms/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-8">
      <Typography.Heading level={1}>Brainstorm</Typography.Heading>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
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

  const rows: BrainstormRow[] = brainstorm.rows.map((r) => ({
    keywordId: r.keywordId,
    country: r.country,
    phrase: r.phrase,
    volume: r.latest?.volume ?? null,
    difficulty: r.latest?.difficulty ?? null,
    queued: r.queued,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Typography.Paragraph>{brainstorm.idea}</Typography.Paragraph>
      <BrainstormTable rows={rows} />
    </div>
  );
}
