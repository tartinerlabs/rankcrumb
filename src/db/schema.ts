import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// One App Store search result as stored on a check; ratings are per storefront.
export type TopApp = {
  id: number;
  name: string;
  icon: string;
  ratings: number;
  avg: number;
};

export type Schedule = "off" | "daily" | "weekly";
/** localized: AI fills a phrase for each new storefront. english: English storefronts get the label, others none. manual: only phrases set explicitly. */
export type TermMode = "localized" | "english" | "manual";
/** Name, subtitle and keyword field of one locale (same shape as Listing in src/lib/asc.ts). */
export type ListingText = { name: string; subtitle: string; keywords: string };

export const keywords = snakeCase.table(
  "keywords",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    phrase: text().notNull(),
    country: varchar({ length: 2 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Set while a check is queued: the first enqueue time, kept across retries
    queuedAt: timestamp({ withTimezone: true }),
    // 0 = someone is waiting, 1 = scheduled; a user enqueue lowers it
    queuePriority: smallint().notNull().default(1),
    // Failed tries of the queued check; dropped after 3
    attempts: smallint().notNull().default(0),
  },
  (t) => [
    uniqueIndex().on(t.country, t.phrase),
    // Target of term_phrases' composite FK, so a phrase row's country always matches its keyword
    uniqueIndex().on(t.id, t.country),
    check("keywords_country_ck", sql`${t.country} ~ '^[a-z]{2}$'`),
    index()
      .on(t.attempts, t.queuePriority, t.queuedAt)
      .where(sql`${t.queuedAt} is not null`),
  ],
);

export const keywordChecks = snakeCase.table(
  "keyword_checks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    keywordId: integer()
      .notNull()
      .references(() => keywords.id, { onDelete: "cascade" }),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    volume: smallint().notNull(),
    difficulty: smallint().notNull(),
    // Search results in rank order (index 0 = rank 1)
    topApps: jsonb().$type<TopApp[]>().notNull(),
    appId: bigint({ mode: "number" }),
    rank: smallint(),
  },
  (t) => [
    index().on(t.keywordId, t.checkedAt.desc()),
    check("keyword_checks_volume_ck", sql`${t.volume} between 0 and 100`),
    check(
      "keyword_checks_difficulty_ck",
      sql`${t.difficulty} between 0 and 100`,
    ),
  ],
);

// Apps by App Store track ID: workspaces (mine or researched) plus competitor-only rows
export const apps = snakeCase.table(
  "apps",
  {
    trackId: bigint({ mode: "number" }).primaryKey(),
    name: text().notNull(),
    icon: text().notNull(),
    isMine: boolean().notNull().default(false),
    developer: text().notNull().default(""),
    // Storefront the app was found in; the daily refresh looks it up there
    storefront: varchar({ length: 2 }).notNull().default("us"),
    // Storefronts researched for this app, in display order
    countries: varchar({ length: 2 }).array().notNull().default(sql`'{}'`),
    // App Store Connect locale of the main listing
    language: text().notNull().default("en-US"),
    schedule: text().$type<Schedule>().notNull().default("daily"),
    // Last read listing per locale (App Store Connect for own apps, else name only)
    listing: jsonb().$type<Record<string, ListingText>>(),
    // Set when added on the start screen; null for apps only seen as competitors
    addedAt: timestamp({ withTimezone: true }),
    // Set by Remove so Undo can restore the workspace; cron purges the app after a day
    removedAt: timestamp({ withTimezone: true }),
    refreshedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("apps_schedule_ck", sql`${t.schedule} in ('off', 'daily', 'weekly')`),
  ],
);

// Keywords tracked for an app (refreshed daily)
export const appKeywords = snakeCase.table(
  "app_keywords",
  {
    appId: bigint({ mode: "number" })
      .notNull()
      .references(() => apps.trackId, { onDelete: "cascade" }),
    keywordId: integer()
      .notNull()
      .references(() => keywords.id, { onDelete: "cascade" }),
    // Groups local phrases of one keyword across storefronts; null means the phrase itself
    label: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.keywordId] })],
);

export const appCompetitors = snakeCase.table(
  "app_competitors",
  {
    appId: bigint({ mode: "number" })
      .notNull()
      .references(() => apps.trackId, { onDelete: "cascade" }),
    competitorId: bigint({ mode: "number" })
      .notNull()
      .references(() => apps.trackId, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.competitorId] }),
    check("app_competitors_self_ck", sql`${t.appId} <> ${t.competitorId}`),
  ],
);

// One English keyword of an app; its local phrase per storefront is in term_phrases
export const terms = snakeCase.table(
  "terms",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    appId: bigint({ mode: "number" })
      .notNull()
      .references(() => apps.trackId, { onDelete: "cascade" }),
    // Normalised English keyword (the phrase itself for manual terms)
    label: text().notNull(),
    mode: text().$type<TermMode>().notNull().default("localized"),
    // Hidden terms keep history but are not checked on schedule
    hidden: boolean().notNull().default(false),
    // Soft delete so Undo restores phrases; purged by cron after a day
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.appId, t.label),
    check(
      "terms_mode_ck",
      sql`${t.mode} in ('localized', 'english', 'manual')`,
    ),
  ],
);

// The local phrase of a term in one storefront, linked to the shared keyword and its checks
export const termPhrases = snakeCase.table(
  "term_phrases",
  {
    termId: integer()
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    country: varchar({ length: 2 }).notNull(),
    // Null when the user cleared this storefront; AI never refills it
    keywordId: integer(),
    // Set by the user; AI localization never overwrites it
    edited: boolean().notNull().default(false),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.termId, t.country] }),
    foreignKey({
      columns: [t.keywordId, t.country],
      foreignColumns: [keywords.id, keywords.country],
    }).onDelete("cascade"),
    index().on(t.keywordId),
  ],
);

// A saved niche idea with the AI keywords proposed for it; not tied to an app
export const brainstorms = snakeCase.table("brainstorms", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  idea: text().notNull(),
  countries: varchar({ length: 2 }).array().notNull(),
  // keywords rows proposed for the idea, in AI order
  keywordIds: integer().array().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Single row shared by every function: App Store request slots, rate-limit pause and the worker lease
export const checkWorker = snakeCase.table(
  "check_worker",
  {
    id: smallint().primaryKey().default(1),
    // Earliest time the next App Store request may start
    nextSlotAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    pausedUntil: timestamp({ withTimezone: true }),
    // Consecutive throttles; backoff 60s, 120s, then 240s; reset on success
    throttles: smallint().notNull().default(0),
    // Requests since the last throttle, logged on each throttle to measure the real rate
    requests: integer().notNull().default(0),
    lastThrottledAt: timestamp({ withTimezone: true }),
    // Random token of the worker holding the lease
    workerId: text(),
    leaseUntil: timestamp({ withTimezone: true }),
  },
  (t) => [check("check_worker_single_ck", sql`${t.id} = 1`)],
);
