import "server-only";

import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { keywords } from "@/db/schema";
import { appRow, recordCheck, UserError } from "@/lib/checks";
import {
  APPLE_GAP_MS,
  acquireLease,
  gateState,
  releaseLease,
  renewLease,
  SlotDeadlineError,
} from "@/lib/gate";
import { InvalidStorefrontError, ThrottledError } from "@/lib/itunes";

// The queue is the keywords rows themselves: queued_at set means a check is pending.

/** Worker time per run, under the queue route's 300s maxDuration. */
export const BUDGET_MS = 270_000;
const MAX_ATTEMPTS = 3;
// Room before the deadline to finish the current item
const STOP_MARGIN_MS = 15_000;
const LEASE_RENEW_MS = 30_000;
const HOUR_MS = 3_600_000;

export type Scope = { appId: number } | { brainstormId: number };
export type Progress = {
  pending: number;
  done: number;
  total: number;
  state: "idle" | "running" | "paused" | "stalled";
  pausedUntil: string | null;
  etaSeconds: number;
};
export type DrainResult = {
  checked: number;
  failed: number;
  remaining: number;
  paused: boolean;
  pausedUntil: Date | null;
  busy: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idsSchema = z.array(z.number().int().positive());

/**
 * Queue checks of keywords with no check within maxAge (already queued ones
 * stay queued, keep their first time and take the higher priority). Starts the
 * worker when anything is pending. Returns the keywords now pending from this call.
 */
export async function enqueue(
  keywordIds: number[],
  opts: { maxAgeMs?: number; priority?: 0 | 1 } = {},
): Promise<number> {
  const parsed = z
    .object({
      keywordIds: idsSchema,
      maxAgeMs: z
        .number()
        .int()
        .min(0)
        .default(20 * HOUR_MS),
      priority: z.union([z.literal(0), z.literal(1)]).default(0),
    })
    .safeParse({ keywordIds, ...opts });
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const { maxAgeMs, priority } = parsed.data;
  const ids = [...new Set(parsed.data.keywordIds)];
  if (ids.length === 0) return 0;

  const { rows } = await db.execute<{ id: number }>(sql`
    update keywords k
    set queued_at = coalesce(k.queued_at, now()),
      queue_priority = least(k.queue_priority, ${priority}::smallint)
    where k.id in ${ids}
      and (k.queued_at is not null or not exists (
        select 1 from keyword_checks c
        where c.keyword_id = k.id
          and c.checked_at > now() - make_interval(secs => ${maxAgeMs / 1000}::float8)
      ))
    returning k.id`);
  if (rows.length > 0) after(kick);
  return rows.length;
}

/** Cron: queue every scheduled keyword with no check within its apps' schedule. One statement, safe to run twice. */
export async function enqueueDue(): Promise<number> {
  const { rows } = await db.execute<{ id: number }>(sql`
    with due as (
      select tp.keyword_id as id,
        case a.schedule when 'weekly' then interval '6 days 20 hours' else interval '20 hours' end as max_age
      from term_phrases tp
      join terms t on t.id = tp.term_id
      join apps a on a.track_id = t.app_id
      where not t.hidden and t.deleted_at is null
        and a.added_at is not null and a.schedule <> 'off'
        and tp.country = any(a.countries)
        and tp.keyword_id is not null
    )
    update keywords k set queued_at = coalesce(k.queued_at, now())
    from (select id, min(max_age) as max_age from due group by id) d
    where k.id = d.id and k.queued_at is null
      and not exists (
        select 1 from keyword_checks c
        where c.keyword_id = k.id and c.checked_at > now() - d.max_age
      )
    returning k.id`);
  return rows.length;
}

/** Keyword ids of an app's visible terms in its researched storefronts. Shared by Check now, Pause and progress so they agree. */
function appKeywordIds(appId: number) {
  return sql`select tp.keyword_id from term_phrases tp
    join terms t on t.id = tp.term_id
    join apps a on a.track_id = t.app_id
    where t.app_id = ${appId} and not t.hidden
      and t.deleted_at is null and tp.keyword_id is not null
      and tp.country = any(a.countries)`;
}

/** Queue checks older than an hour for an app's keywords (all visible ones, or the given terms), ahead of scheduled ones. */
export async function checkNow(
  appId: number,
  termIds?: number[],
): Promise<number> {
  await appRow(appId);
  const parsed = idsSchema.optional().safeParse(termIds);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const picked = parsed.data;
  if (picked?.length === 0) return 0;

  const { rows } = await db.execute<{ id: number }>(
    picked
      ? sql`
        select distinct tp.keyword_id as id
        from term_phrases tp
        join terms t on t.id = tp.term_id
        join apps a on a.track_id = t.app_id
        where t.app_id = ${appId} and t.deleted_at is null
          and tp.keyword_id is not null and tp.country = any(a.countries)
          and t.id in ${picked}`
      : sql`select keyword_id as id from (${appKeywordIds(appId)}) ids`,
  );
  return enqueue(
    rows.map((r) => r.id),
    { maxAgeMs: HOUR_MS, priority: 0 },
  );
}

/**
 * Pause an app's run: take its pending checks off the queue (the one being
 * checked finishes). Keywords another workspace or a brainstorm also needs stay
 * queued, since keyword rows are shared. Check now (or resumeChecks) queues the
 * rest again, and the next schedule brings them back anyway. Returns the checks taken off.
 */
export async function pauseChecks(appId: number): Promise<number> {
  await appRow(appId);
  const { rows } = await db.execute<{ id: number }>(sql`
    update keywords k
    set queued_at = null, queue_priority = 1, attempts = 0
    where k.queued_at is not null and k.id in (${appKeywordIds(appId)})
      and not exists (
        select 1 from term_phrases tp
        join terms t on t.id = tp.term_id
        join apps a on a.track_id = t.app_id
        where tp.keyword_id = k.id and t.app_id <> ${appId}
          and not t.hidden and t.deleted_at is null
          and a.added_at is not null and tp.country = any(a.countries)
      )
      and not exists (
        select 1 from brainstorms b where k.id = any(b.keyword_ids)
      )
    returning k.id`);
  return rows.length;
}

/** Pair of pauseChecks: queue the app's checks not done in the last hour again. Same as Check now. */
export async function resumeChecks(appId: number): Promise<number> {
  return checkNow(appId);
}

async function countQueued() {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(keywords)
    .where(isNotNull(keywords.queuedAt));
  return n;
}

/**
 * Check queued keywords one at a time until the deadline, holding the worker
 * lease. Sleeps through a pause that ends inside the budget; stops on a longer
 * one. A failed check is retried up to 3 times behind the others.
 */
export async function drain(deadline: number): Promise<DrainResult> {
  const workerId = crypto.randomUUID();
  const result: DrainResult = {
    checked: 0,
    failed: 0,
    remaining: 0,
    paused: false,
    pausedUntil: null,
    busy: false,
  };
  if (!(await acquireLease(workerId))) {
    return { ...result, busy: true, remaining: await countQueued() };
  }

  try {
    loop: while (Date.now() + STOP_MARGIN_MS < deadline) {
      if (!(await renewLease(workerId))) break;

      // Time left comes from the DB clock, which also decides the pause in takeSlot
      const { pausedUntil, pauseLeftMs } = await gateState();
      if (pauseLeftMs > 0) {
        const end = Date.now() + pauseLeftMs;
        if (end >= deadline - STOP_MARGIN_MS) {
          result.paused = true;
          result.pausedUntil = pausedUntil;
          break;
        }
        while (Date.now() < end) {
          await sleep(Math.min(LEASE_RENEW_MS, end - Date.now()));
          if (!(await renewLease(workerId))) break loop;
        }
        continue;
      }

      const [item] = await db
        .select({
          id: keywords.id,
          phrase: keywords.phrase,
          country: keywords.country,
        })
        .from(keywords)
        .where(isNotNull(keywords.queuedAt))
        .orderBy(
          asc(keywords.attempts),
          asc(keywords.queuePriority),
          asc(keywords.queuedAt),
          asc(keywords.id),
        )
        .limit(1);
      if (!item) break;

      try {
        await recordCheck(item.phrase, item.country, null, { deadline });
        await db
          .update(keywords)
          .set({ queuedAt: null, attempts: 0, queuePriority: 1 })
          .where(eq(keywords.id, item.id));
        result.checked++;
      } catch (e) {
        if (e instanceof SlotDeadlineError) {
          // Other callers hold the next slots; wait inside this run rather than ending and kicking
          if (Date.now() + STOP_MARGIN_MS + 30_000 >= deadline) break;
          await sleep(APPLE_GAP_MS * 2);
          continue;
        }
        // Includes QueuePausedError; the pause check above waits it out
        if (e instanceof ThrottledError) continue;
        result.failed++;
        if (e instanceof InvalidStorefrontError) {
          await db
            .update(keywords)
            .set({ queuedAt: null, attempts: 0, queuePriority: 1 })
            .where(eq(keywords.id, item.id));
          continue;
        }
        if (!(e instanceof DOMException && e.name === "TimeoutError")) {
          console.error(`drain ${item.country} "${item.phrase}"`, e);
        }
        // Dropped after the last attempt; the next schedule or enqueue brings it back
        await db.execute(sql`
          update keywords set
            attempts = case when attempts + 1 >= ${MAX_ATTEMPTS} then 0 else attempts + 1 end,
            queued_at = case when attempts + 1 >= ${MAX_ATTEMPTS} then null else queued_at end,
            queue_priority = case when attempts + 1 >= ${MAX_ATTEMPTS} then 1 else queue_priority end
          where id = ${item.id}`);
      }
    }
  } finally {
    await releaseLease(workerId);
  }

  result.remaining = await countQueued();
  return result;
}

/** Drain, then start the next run when work is left and any pause ends inside its budget. */
export async function work(deadline: number): Promise<DrainResult> {
  const r = await drain(deadline);
  if (
    !r.busy &&
    r.remaining > 0 &&
    (!r.pausedUntil ||
      r.pausedUntil.getTime() < Date.now() + BUDGET_MS - STOP_MARGIN_MS)
  ) {
    await kick();
  }
  return r;
}

/** The deployment's own origin, from env vars only (never the request Host). */
function origin() {
  if (process.env.VERCEL_ENV === "production") {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/** Start a worker run in its own function. Safe to call often: extra runs find the lease taken. */
export async function kick(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.VERCEL) {
      console.error("[queue] CRON_SECRET is not set; cannot start the worker");
      return;
    }
    // Local dev without a secret: drain in this process
    void work(Date.now() + BUDGET_MS).catch((e) =>
      console.error("[queue] work", e),
    );
    return;
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  await fetch(`${origin()}/api/queue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      ...(bypass && { "x-vercel-protection-bypass": bypass }),
    },
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => console.error("[queue] kick", e));
}

/**
 * Pending and done checks of an app's keywords or a brainstorm's, with the
 * worker state. state "paused" is an App Store rate-limit pause, not pauseChecks:
 * after pauseChecks pending is 0 and state is "idle". Show Pause while pending > 0.
 */
export async function getProgress(scope: Scope): Promise<Progress> {
  const parsed = z
    .union([
      z.object({ appId: z.number().int().positive() }),
      z.object({ brainstormId: z.number().int().positive() }),
    ])
    .safeParse(scope);
  if (!parsed.success) throw new UserError("Unknown app or brainstorm");
  const ids =
    "appId" in parsed.data
      ? appKeywordIds(parsed.data.appId)
      : sql`select unnest(keyword_ids) from brainstorms where id = ${parsed.data.brainstormId}`;

  const { rows } = await db.execute<{
    pending: number;
    done: number;
    paused: boolean | null;
    pause_left_s: number | null;
    // Raw timestamptz text from db.execute
    paused_until: string | null;
    running: boolean | null;
  }>(sql`
    with s as (select k.id, k.queued_at from keywords k where k.id in (${ids})),
    p as (select count(*) filter (where queued_at is not null)::int as pending,
      min(queued_at) as since from s)
    select p.pending,
      (select count(*)::int from s
        where s.queued_at is null and p.since is not null
          and exists (select 1 from keyword_checks c
            where c.keyword_id = s.id and c.checked_at >= p.since)) as done,
      w.paused_until > now() as paused,
      greatest(extract(epoch from (w.paused_until - now())), 0)::float8 as pause_left_s,
      w.paused_until,
      w.lease_until > now() as running
    from p left join check_worker w on w.id = 1`);
  const r = rows[0];
  const paused = Boolean(r.paused);
  const state: Progress["state"] = paused
    ? "paused"
    : r.running
      ? "running"
      : r.pending > 0
        ? "stalled"
        : "idle";
  return {
    pending: r.pending,
    done: r.done,
    total: r.pending + r.done,
    state,
    pausedUntil:
      paused && r.paused_until ? new Date(r.paused_until).toISOString() : null,
    etaSeconds: Math.ceil(
      (r.pending * APPLE_GAP_MS) / 1000 + (paused ? (r.pause_left_s ?? 0) : 0),
    ),
  };
}

/** Cron: remove terms deleted more than a day ago (past Undo). */
export async function purgeDeleted(): Promise<number> {
  const { rows } = await db.execute<{ id: number }>(
    sql`delete from terms where deleted_at < now() - interval '1 day' returning id`,
  );
  return rows.length;
}
