import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { checkWorker } from "@/db/schema";

// One App Store request slot per gap across every function; tune from the [gate] throttle logs
export const APPLE_GAP_MS = 3500;
const MAX_SLOT_WAIT_MS = 30_000;
const LEASE_MS = 60_000;
// Room after the slot for the request itself before the caller's deadline
const DEADLINE_MARGIN_MS = 12_000;

/** Apple throttled the request (403, 429 or a non-JSON body); wait and retry later. */
export class ThrottledError extends Error {
  constructor(message = "App Store search is rate limited") {
    super(message);
    this.name = "ThrottledError";
  }
}

/** A recent throttle paused all App Store requests until `until`; no slot was taken. */
export class QueuePausedError extends ThrottledError {
  constructor(readonly until: Date) {
    super("App Store requests are paused after a throttle");
    this.name = "QueuePausedError";
  }
}

/** The next free slot is past the caller's deadline or the longest wait; no slot was taken. */
export class SlotDeadlineError extends ThrottledError {
  constructor() {
    super("No App Store request slot before the deadline");
    this.name = "SlotDeadlineError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The single row is created lazily, once per process
let rowReady: Promise<unknown> | undefined;
function ensureRow() {
  rowReady ??= db
    .insert(checkWorker)
    .values({ id: 1 })
    .onConflictDoNothing()
    .catch((e) => {
      rowReady = undefined;
      throw e;
    });
  return rowReady;
}

/**
 * Reserve the next App Store request slot, then wait for it. One UPDATE checks
 * the pause and the deadline and reserves the slot, so a caller that would
 * miss its deadline reserves nothing. The wait comes from the DB clock.
 */
export async function takeSlot(deadline?: number): Promise<void> {
  await ensureRow();
  const maxWaitSec =
    Math.min(
      deadline === undefined
        ? MAX_SLOT_WAIT_MS
        : deadline - Date.now() - DEADLINE_MARGIN_MS,
      MAX_SLOT_WAIT_MS,
    ) / 1000;
  const gapSec = APPLE_GAP_MS / 1000;

  const { rows } = await db.execute<{ wait_ms: number }>(sql`
    update check_worker
    set next_slot_at = greatest(next_slot_at, now()) + make_interval(secs => ${gapSec}::float8),
      requests = requests + 1
    where id = 1
      and (paused_until is null or paused_until <= now())
      and greatest(next_slot_at, now()) <= now() + make_interval(secs => ${maxWaitSec}::float8)
    returning greatest(extract(epoch from (next_slot_at - make_interval(secs => ${gapSec}::float8) - now())) * 1000, 0)::float8 as wait_ms`);

  if (rows.length > 0) {
    const wait = Number(rows[0].wait_ms);
    if (wait > 0) {
      await sleep(wait);
      // A throttle during the wait pauses this slot too
      const pausedUntil = await activePause();
      if (pausedUntil) throw new QueuePausedError(pausedUntil);
    }
    return;
  }

  const pausedUntil = await activePause();
  if (pausedUntil) throw new QueuePausedError(pausedUntil);
  throw new SlotDeadlineError();
}

/** The pause end when a pause is running by the DB clock, else null. */
async function activePause(): Promise<Date | null> {
  const [row] = await db
    .select({ pausedUntil: checkWorker.pausedUntil })
    .from(checkWorker)
    .where(and(eq(checkWorker.id, 1), sql`${checkWorker.pausedUntil} > now()`));
  return row?.pausedUntil ?? null;
}

/**
 * Pause every App Store request with backoff 60s, 120s, then 240s, and log the
 * rate since the last throttle. Requests already in flight that are throttled
 * by the same event leave a running pause and its count as they are.
 */
export async function reportThrottle(): Promise<Date> {
  await ensureRow();
  const { rows } = await db.execute<{
    paused_until: string;
    requests: number;
    since_s: number | null;
  }>(sql`
    update check_worker w
    set paused_until = now() + interval '60 seconds' * power(2, least(w.throttles, 2)),
      throttles = w.throttles + 1,
      last_throttled_at = now(),
      requests = 0
    from (select requests, last_throttled_at from check_worker where id = 1) old
    where w.id = 1 and (w.paused_until is null or w.paused_until <= now())
    returning w.paused_until, old.requests,
      extract(epoch from (now() - old.last_throttled_at))::float8 as since_s`);
  if (rows.length === 0) {
    const running = await activePause();
    if (running) return running;
    // The pause ended between the update and this read; start a new one
    return reportThrottle();
  }
  const pausedUntil = new Date(rows[0].paused_until);
  console.warn("[gate] throttled", {
    requests: rows[0].requests,
    sinceLastThrottleS:
      rows[0].since_s === null ? null : Math.round(rows[0].since_s),
    pausedUntil: pausedUntil.toISOString(),
  });
  return pausedUntil;
}

/** Reset the backoff after an ok response; writes only after a throttle. */
export async function reportSuccess(): Promise<void> {
  await db.execute(
    sql`update check_worker set throttles = 0 where id = 1 and throttles > 0`,
  );
}

/** Take the worker lease when it is free, expired or already ours. */
export async function acquireLease(workerId: string): Promise<boolean> {
  await ensureRow();
  const { rows } = await db.execute<{ ok: number }>(sql`
    update check_worker
    set worker_id = ${workerId}, lease_until = now() + make_interval(secs => ${LEASE_MS / 1000}::float8)
    where id = 1
      and (lease_until is null or lease_until < now() or worker_id = ${workerId})
    returning 1 as ok`);
  return rows.length > 0;
}

/** Extend our lease; false when another worker took it over. */
export async function renewLease(workerId: string): Promise<boolean> {
  const { rows } = await db.execute<{ ok: number }>(sql`
    update check_worker
    set lease_until = now() + make_interval(secs => ${LEASE_MS / 1000}::float8)
    where id = 1 and worker_id = ${workerId}
    returning 1 as ok`);
  return rows.length > 0;
}

export async function releaseLease(workerId: string): Promise<void> {
  await db.execute(
    sql`update check_worker set lease_until = null where id = 1 and worker_id = ${workerId}`,
  );
}

/** Current pause (and its time left by the DB clock), lease and throttle count (all empty before the row exists). */
export async function gateState(): Promise<{
  pausedUntil: Date | null;
  pauseLeftMs: number;
  leaseUntil: Date | null;
  throttles: number;
}> {
  const [row] = await db
    .select({
      pausedUntil: checkWorker.pausedUntil,
      pauseLeftMs:
        sql<number>`coalesce(greatest(extract(epoch from (${checkWorker.pausedUntil} - now())), 0), 0) * 1000`.mapWith(
          Number,
        ),
      leaseUntil: checkWorker.leaseUntil,
      throttles: checkWorker.throttles,
    })
    .from(checkWorker)
    .where(eq(checkWorker.id, 1));
  return (
    row ?? { pausedUntil: null, pauseLeftMs: 0, leaseUntil: null, throttles: 0 }
  );
}
