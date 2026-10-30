import { after, type NextRequest } from "next/server";
import { refreshAppMeta } from "@/lib/meta";
import { BUDGET_MS, enqueueDue, purgeDeleted, work } from "@/lib/queue";

// Hobby caps functions at 300s; each run handles what fits and chains the next run
export const maxDuration = 300;

const META_BUDGET_MS = 45_000;

/** Vercel Cron: purge old deleted terms, queue due checks, refresh app details, then drain the queue. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const start = Date.now();
  await purgeDeleted();
  const queued = await enqueueDue();
  const { refreshed } = await refreshAppMeta({
    deadline: start + META_BUDGET_MS,
  });
  after(() => work(start + BUDGET_MS));
  return Response.json({ queued, refreshed });
}
