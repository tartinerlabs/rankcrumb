import "server-only";

import { refresh } from "next/cache";
import { UserError } from "@/lib/checks";
import { gateState, QueuePausedError, ThrottledError } from "@/lib/gate";
import { InvalidStorefrontError } from "@/lib/itunes";

export type ActionResult<T> =
  | { data: T; error?: undefined }
  | { error: string; data?: undefined };

/**
 * Run a Server Action body: user-facing failures become { error }, anything
 * else is thrown. Refreshes the client router after a mutation. Server Actions only.
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
  }
}
