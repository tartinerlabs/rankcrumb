import { after, type NextRequest } from "next/server";
import { UserError } from "@/lib/checks";
import { getProgress, kick, type Scope } from "@/lib/queue";

/** Check progress of an app or a brainstorm, polled by the UI. Restarts a stalled worker. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const appId = params.get("appId");
  const brainstormId = params.get("brainstormId");
  const scope: Scope | null = appId
    ? { appId: Number(appId) }
    : brainstormId
      ? { brainstormId: Number(brainstormId) }
      : null;
  if (!scope) {
    return Response.json(
      { error: "Pass appId or brainstormId" },
      { status: 400 },
    );
  }

  try {
    const progress = await getProgress(scope);
    // Pending work, no live lease and no pause: the chain broke, so start it again
    if (progress.state === "stalled") after(kick);
    return Response.json(progress);
  } catch (e) {
    if (e instanceof UserError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
