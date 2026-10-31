import { revalidateTag } from "next/cache";
import { after, type NextRequest } from "next/server";
import { BUDGET_MS, work } from "@/lib/queue";

// Hobby caps functions at 300s; the worker stops 30s short and chains the next run
export const maxDuration = 300;

/** Start one worker run after answering; kick() calls this so each run gets its own function. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Expire after the run: a tag expiry only reaches the cache once the after() callback ends
  after(async () => {
    try {
      await work(Date.now() + BUDGET_MS);
    } finally {
      revalidateTag("checks", { expire: 0 });
    }
  });
  return new Response(null, { status: 202 });
}
