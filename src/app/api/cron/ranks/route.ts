import { revalidateTag } from "next/cache";
import { after, type NextRequest } from "next/server";
import { CACHE_TAGS } from "@/actions/act";
import { purgeRemovedApps } from "@/lib/apps";
import { refreshAppMeta } from "@/lib/meta";
import { BUDGET_MS, enqueueDue, purgeDeleted, work } from "@/lib/queue";

// Hobby caps functions at 300s; each run handles what fits and chains the next run
export const maxDuration = 300;

const META_BUDGET_MS = 45_000;

/** Vercel Cron: purge old deleted terms and removed apps, queue due checks, refresh app details, then drain the queue. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const start = Date.now();
  // Via after(): it also lands when a step below throws partway
  after(() => {
    for (const tag of CACHE_TAGS) revalidateTag(tag, { expire: 0 });
  });
  await purgeDeleted();
  await purgeRemovedApps();
  const queued = await enqueueDue();
  const { refreshed } = await refreshAppMeta({
    deadline: start + META_BUDGET_MS,
  });
  // Expire after the run: a tag expiry only reaches the cache once the after() callback ends
  after(async () => {
    try {
      await work(start + BUDGET_MS);
    } finally {
      revalidateTag("checks", { expire: 0 });
    }
  });
  return Response.json({ queued, refreshed });
}
