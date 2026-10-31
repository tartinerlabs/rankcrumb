import "server-only";

import { refresh, updateTag } from "next/cache";
import { UserError } from "@/lib/checks";
import { gateState, QueuePausedError, ThrottledError } from "@/lib/gate";
import { InvalidStorefrontError } from "@/lib/itunes";

/** Every cacheTag used by the cached reads; writers expire all of them. */
export const CACHE_TAGS = ["apps", "checks", "brainstorms"] as const;

export type ActionResult<T> =
  | { data: T; error?: undefined }
  | { error: string; data?: undefined };

/**
 * Run a Server Action body: user-facing failures become { error }, anything
 * else is thrown. After a mutation, expires the cached reads (even when the body
 * throws partway) and refreshes the client router. Server Actions only.
 */
export async function act<T>(
  fn: () => Promise<T>,
  mutates = false,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (mutates) refresh();
    return { data };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof InvalidStorefrontError) {
      return { error: "Unknown App Store storefront" };
    }
    if (e instanceof ThrottledError) {
      const until =
        e instanceof QueuePausedError
          ? e.until
          : (await gateState()).pausedUntil;
      return {
        error:
          until && until.getTime() > Date.now()
            ? `App Store is rate limiting searches. Try again after ${until.toISOString().slice(11, 16)} UTC.`
            : "App Store is rate limiting searches. Try again in a minute.",
      };
    }
    throw e;
  } finally {
    if (mutates) for (const tag of CACHE_TAGS) updateTag(tag);
  }
}
