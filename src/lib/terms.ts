import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  appCompetitors,
  apps,
  keywords,
  type TermMode,
  termPhrases,
  terms,
} from "@/db/schema";
import { isEnglish, localize } from "@/lib/ai";
import {
  type AppRef,
  appRow,
  HISTORY,
  type Latest,
  latestChecks,
  savePhrases,
  UserError,
} from "@/lib/checks";
import { listingText } from "@/lib/meta";
import { enqueue } from "@/lib/queue";
import { isCovered, type NextStep, nextStep, normalize } from "@/lib/scoring";

const MAX_PHRASE_LENGTH = 100;
const MAX_TERMS = 100;
const MAX_COUNTRIES = 40;
const HOUR_MS = 3_600_000;
// Rank used for "not in the top 200" when computing a rank change
const UNRANKED = 201;

const countrySchema = z
  .string()
  .regex(/^[a-z]{2}$/, "Storefront codes are two letters");
const idsSchema = z.array(z.number().int().positive()).max(1000);

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  return parsed.data;
}

export type Cell = {
  phrase: string | null;
  keywordId: number | null;
  edited: boolean;
  latest: Latest | null;
  queued: boolean;
};

export type TermRow = {
  id: number;
  label: string;
  mode: TermMode;
  hidden: boolean;
  group: "listing" | "ideas";
  /** Only storefronts with a term_phrases row; a null phrase was cleared on purpose */
  cells: Record<string, Cell>;
  top10: number;
  checked: number;
  avgVolume: number | null;
  avgDifficulty: number | null;
  /** Distinct local phrases */
  phrases: number;
  /** Storefronts with a phrase */
  countries: number;
};

export type Board = {
  countries: string[];
  terms: TermRow[];
  summary: { country: string; top10: number; total: number }[];
};

/** Phrase rows of an app's non-deleted terms in the given storefronts, with the keyword and its queue state. */
async function phraseRows(appId: number, countries: string[]) {
  if (countries.length === 0) return [];
  return db
    .select({
      termId: termPhrases.termId,
      label: terms.label,
      hidden: terms.hidden,
      country: termPhrases.country,
      keywordId: termPhrases.keywordId,
      edited: termPhrases.edited,
      phrase: keywords.phrase,
      queued: sql<boolean>`${keywords.queuedAt} is not null`,
    })
    .from(termPhrases)
    .innerJoin(terms, eq(terms.id, termPhrases.termId))
    .leftJoin(keywords, eq(keywords.id, termPhrases.keywordId))
    .where(
      and(
        eq(terms.appId, appId),
        isNull(terms.deletedAt),
        inArray(termPhrases.country, countries),
      ),
    );
}

const keywordIdsOf = (rows: { keywordId: number | null }[]) =>
  rows.flatMap((r) => (r.keywordId === null ? [] : [r.keywordId]));

const isTop10 = (l: Latest | null) =>
  l !== null && l.rank !== null && l.rank <= 10;

const average = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/**
 * Every non-deleted term of an app with its phrase and latest check per
 * storefront; hidden terms are included and flagged. A term is in the listing
 * group when any phrase is covered by that storefront's listing text. Sorted by
 * average volume, highest first, unchecked last.
 */
export async function loadBoard(appId: number): Promise<Board> {
  const app = await appRow(appId);
  const { countries } = app;
  const [termList, phrases] = await Promise.all([
    db
      .select({
        id: terms.id,
        label: terms.label,
        mode: terms.mode,
        hidden: terms.hidden,
      })
      .from(terms)
      .where(and(eq(terms.appId, appId), isNull(terms.deletedAt)))
      .orderBy(asc(terms.label)),
    phraseRows(appId, countries),
  ]);
  const latest = await latestChecks(keywordIdsOf(phrases), { appId });

  const cellsByTerm = new Map<number, Record<string, Cell>>();
  for (const r of phrases) {
    const cells = cellsByTerm.get(r.termId) ?? {};
    cells[r.country] = {
      phrase: r.phrase,
      keywordId: r.keywordId,
      edited: r.edited,
      latest: (r.keywordId !== null && latest.get(r.keywordId)) || null,
      queued: r.queued,
    };
    cellsByTerm.set(r.termId, cells);
  }
  const listing = new Map(countries.map((c) => [c, listingText(app, c)]));

  const rows: TermRow[] = termList.map((t) => {
    const cells = cellsByTerm.get(t.id) ?? {};
    const filled = Object.entries(cells).filter(([, c]) => c.phrase !== null);
    const checked = Object.values(cells).flatMap((c) =>
      c.latest ? [c.latest] : [],
    );
    return {
      ...t,
      group: filled.some(([country, c]) =>
        isCovered(c.phrase as string, listing.get(country) ?? app.name),
      )
        ? "listing"
        : "ideas",
      cells,
      top10: checked.filter(isTop10).length,
      checked: checked.length,
      avgVolume: average(checked.map((l) => l.volume)),
      avgDifficulty: average(checked.map((l) => l.difficulty)),
      phrases: new Set(filled.map(([, c]) => c.phrase)).size,
      countries: filled.length,
    };
  });
  rows.sort((a, b) => (b.avgVolume ?? -1) - (a.avgVolume ?? -1));

  const visible = rows.filter((t) => !t.hidden);
  return {
    countries,
    terms: rows,
    summary: countries.map((country) => {
      const cells = visible.flatMap((t) => {
        const c = t.cells[country];
        return c && c.phrase !== null ? [c] : [];
      });
      return {
        country,
        top10: cells.filter((c) => isTop10(c.latest)).length,
        total: cells.length,
      };
    }),
  };
}

export type TrackRow = {
  termId: number;
  label: string;
  phrase: string;
  keywordId: number;
  rank: number | null;
  /** Rank in the check before; null when unranked then or there is no earlier check (rankChange is null then) */
  previousRank: number | null;
  /** Places gained since the check before (negative = dropped); null with no earlier check */
  rankChange: number | null;
  volume: number | null;
  difficulty: number | null;
  top5: AppRef[];
  nextStep: NextStep | null;
  checkedAt: string | null;
  queued: boolean;
};

export type LosingTo = {
  app: AppRef;
  above: number;
  of: number;
  competitor: boolean;
};

async function researchedCountry(appId: number, country: string) {
  const app = await appRow(appId);
  const code = parse(countrySchema, country);
  if (!app.countries.includes(code)) {
    throw new UserError("This storefront is not researched for the app");
  }
  return { app, country: code };
}

/**
 * Visible phrases of an app in one storefront with rank, rank change (unranked
 * counts as 201) and next step, best rank first. losingTo: apps above this app
 * (or in the top 10 when it is unranked) on more than half of the checked
 * phrases, top 3.
 */
export async function loadTrack(
  appId: number,
  country: string,
): Promise<{
  country: string;
  top10: number;
  total: number;
  rows: TrackRow[];
  losingTo: LosingTo[];
}> {
  const { country: code } = await researchedCountry(appId, country);
  const phrases = (await phraseRows(appId, [code])).filter(
    (r) => !r.hidden && r.keywordId !== null && r.phrase !== null,
  );
  const ids = keywordIdsOf(phrases);
  const [latest, competitors] = await Promise.all([
    latestChecks(ids, { appId }),
    db
      .select({ id: appCompetitors.competitorId })
      .from(appCompetitors)
      .where(eq(appCompetitors.appId, appId)),
  ]);
  // Apps above a rank past 11 are outside the top 10; read deeper lists for those only
  const deep = ids.filter((id) => (latest.get(id)?.rank ?? 0) > 11);
  const deepest = Math.max(0, ...deep.map((id) => latest.get(id)?.rank ?? 0));
  const deeper =
    deep.length > 0
      ? await latestChecks(deep, { appId, topN: deepest - 1 })
      : new Map<number, Latest>();

  const rows: TrackRow[] = phrases.map((r) => {
    const keywordId = r.keywordId as number;
    const l = latest.get(keywordId) ?? null;
    return {
      termId: r.termId,
      label: r.label,
      phrase: r.phrase as string,
      keywordId,
      rank: l?.rank ?? null,
      previousRank: l?.previousRank ?? null,
      rankChange:
        l && l.previousRank !== undefined
          ? (l.previousRank ?? UNRANKED) - (l.rank ?? UNRANKED)
          : null,
      volume: l?.volume ?? null,
      difficulty: l?.difficulty ?? null,
      top5: l?.top.slice(0, 5) ?? [],
      nextStep: l ? nextStep(l.rank, l.volume, l.difficulty) : null,
      checkedAt: l?.checkedAt.toISOString() ?? null,
      queued: r.queued,
    };
  });
  rows.sort(
    (a, b) =>
      (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED) ||
      (b.volume ?? -1) - (a.volume ?? -1),
  );

  let of = 0;
  const counts = new Map<number, { app: AppRef; above: number }>();
  for (const id of ids) {
    const l = latest.get(id);
    if (!l) continue;
    of++;
    const above =
      l.rank === null ? l.top : (deeper.get(id) ?? l).top.slice(0, l.rank - 1);
    const seen = new Set<number>();
    for (const a of above) {
      if (a.id === appId || seen.has(a.id)) continue;
      seen.add(a.id);
      const entry = counts.get(a.id) ?? { app: a, above: 0 };
      entry.above++;
      counts.set(a.id, entry);
    }
  }
  const competitorIds = new Set(competitors.map((c) => c.id));
  const losingTo = [...counts.values()]
    .filter((e) => e.above > of / 2)
    .sort((a, b) => b.above - a.above)
    .slice(0, 3)
    .map((e) => ({ ...e, of, competitor: competitorIds.has(e.app.id) }));

  return {
    country: code,
    top10: rows.filter((r) => r.rank !== null && r.rank <= 10).length,
    total: rows.length,
    rows,
    losingTo,
  };
}

export type PaletteKeyword = {
  termId: number;
  label: string;
  appId: number;
  appName: string;
};

/** Every non-deleted term of every workspace, for the command palette; one query, no checks read. */
export async function listPaletteKeywords(): Promise<PaletteKeyword[]> {
  return db
    .select({
      termId: terms.id,
      label: terms.label,
      appId: apps.trackId,
      appName: apps.name,
    })
    .from(terms)
    .innerJoin(apps, eq(apps.trackId, terms.appId))
    .where(and(isNull(terms.deletedAt), isNotNull(apps.addedAt)))
    .orderBy(
      desc(apps.isMine),
      asc(sql`lower(${apps.name})`),
      asc(terms.label),
    );
}

/** A non-deleted term of the app, or UserError. */
async function termOf(appId: number, termId: number) {
  const id = parse(z.number().int().positive(), termId);
  const [term] = await db
    .select({ id: terms.id, label: terms.label })
    .from(terms)
    .where(
      and(eq(terms.id, id), eq(terms.appId, appId), isNull(terms.deletedAt)),
    );
  if (!term) throw new UserError("Keyword not found");
  return term;
}

/** The last 30 checks of each phrase of a term, oldest first, with this app's rank. */
export async function loadHistory(
  appId: number,
  termId: number,
): Promise<{
  label: string;
  series: {
    country: string;
    phrase: string;
    points: {
      checkedAt: string;
      rank: number | null;
      volume: number;
      difficulty: number;
    }[];
  }[];
}> {
  const app = await appRow(appId);
  const term = await termOf(appId, termId);
  const { rows } = await db.execute<{
    country: string;
    phrase: string;
    // Raw timestamptz text from db.execute
    checked_at: string | null;
    volume: number | null;
    difficulty: number | null;
    rank: number | null;
  }>(sql`
    select tp.country, k.phrase, c.checked_at, c.volume, c.difficulty, c.rank
    from term_phrases tp
    join keywords k on k.id = tp.keyword_id
    left join lateral (
      select checked_at, volume, difficulty,
        (select r.i from jsonb_array_elements(top_apps) with ordinality r(app, i)
          where (r.app->>'id')::bigint = ${appId}::bigint limit 1)::int as rank
      from keyword_checks
      where keyword_id = k.id
      order by checked_at desc
      limit ${HISTORY}
    ) c on true
    where tp.term_id = ${term.id}
    order by tp.country, c.checked_at`);

  const series = new Map<
    string,
    Awaited<ReturnType<typeof loadHistory>>["series"][number]
  >();
  for (const r of rows) {
    const s = series.get(r.country) ?? {
      country: r.country,
      phrase: r.phrase,
      points: [],
    };
    if (r.checked_at !== null) {
      s.points.push({
        checkedAt: new Date(r.checked_at).toISOString(),
        rank: r.rank,
        volume: r.volume ?? 0,
        difficulty: r.difficulty ?? 0,
      });
    }
    series.set(r.country, s);
  }
  // Researched storefronts in display order, then any no longer researched
  const order = (c: string) => {
    const i = app.countries.indexOf(c);
    return i === -1 ? app.countries.length : i;
  };
  return {
    label: term.label,
    series: [...series.values()].sort(
      (a, b) =>
        order(a.country) - order(b.country) ||
        a.country.localeCompare(b.country),
    ),
  };
}

/** Queue checks of phrases kept on an app's visible terms (the given terms, or in the given storefronts). */
async function queueKept(
  appId: number,
  where: { termIds?: number[]; countries?: string[] },
): Promise<number> {
  if (where.termIds?.length === 0 || where.countries?.length === 0) return 0;
  const rows = await db
    .select({ keywordId: termPhrases.keywordId })
    .from(termPhrases)
    .innerJoin(terms, eq(terms.id, termPhrases.termId))
    .innerJoin(apps, eq(apps.trackId, terms.appId))
    .where(
      and(
        eq(terms.appId, appId),
        isNull(terms.deletedAt),
        eq(terms.hidden, false),
        isNotNull(termPhrases.keywordId),
        sql`${termPhrases.country} = any(${apps.countries})`,
        where.termIds ? inArray(terms.id, where.termIds) : undefined,
        where.countries
          ? inArray(termPhrases.country, where.countries)
          : undefined,
      ),
    );
  return enqueue(keywordIdsOf(rows), { maxAgeMs: 20 * HOUR_MS, priority: 0 });
}

/**
 * Set the app's researched storefronts in display order (at most 40, each
 * once), queue phrases kept for re-added storefronts, then fill the missing
 * phrases (awaited).
 */
export async function setCountries(
  appId: number,
  countries: string[],
): Promise<{ added: string[]; localized: number; queued: number }> {
  const codes = parse(
    z
      .array(countrySchema)
      .max(MAX_COUNTRIES, `Pick at most ${MAX_COUNTRIES} storefronts`)
      .refine((a) => new Set(a).size === a.length, "Pick each storefront once"),
    countries,
  );
  const app = await appRow(appId);
  const added = codes.filter((c) => !app.countries.includes(c));
  await db
    .update(apps)
    .set({ countries: codes })
    .where(eq(apps.trackId, appId));
  const kept = await queueKept(appId, { countries: added });
  const { localized, queued } = await localizeMissing(appId);
  return { added, localized, queued: kept + queued };
}

/**
 * Idempotent repair: fill each (term, researched storefront) with no phrase
 * row. localized terms get AI phrases (English storefronts get the label),
 * english terms the label in English storefronts only, manual terms nothing.
 * Null and edited rows are never touched. Safe to call again after an AI failure.
 */
export async function localizeMissing(
  appId: number,
  termIds?: number[],
): Promise<{ localized: number; queued: number }> {
  const app = await appRow(appId);
  const ids = termIds === undefined ? undefined : parse(idsSchema, termIds);
  if (app.countries.length === 0 || ids?.length === 0) {
    return { localized: 0, queued: 0 };
  }
  const termList = await db
    .select({ id: terms.id, label: terms.label, mode: terms.mode })
    .from(terms)
    .where(
      and(
        eq(terms.appId, appId),
        isNull(terms.deletedAt),
        ne(terms.mode, "manual"),
        ids ? inArray(terms.id, ids) : undefined,
      ),
    );
  if (termList.length === 0) return { localized: 0, queued: 0 };
  const existing = await db
    .select({ termId: termPhrases.termId, country: termPhrases.country })
    .from(termPhrases)
    .where(
      inArray(
        termPhrases.termId,
        termList.map((t) => t.id),
      ),
    );
  const have = new Set(existing.map((r) => `${r.termId}:${r.country}`));

  const rows: {
    termId: number;
    country: string;
    phrase: string;
    edited: false;
  }[] = [];
  // Terms missing the same storefronts share one localize call
  const groups = new Map<
    string,
    { countries: string[]; termByLabel: Map<string, number> }
  >();
  for (const t of termList) {
    const missing = app.countries.filter((c) => !have.has(`${t.id}:${c}`));
    // Both modes get the label in English storefronts, with no AI call
    for (const country of missing.filter(isEnglish)) {
      rows.push({ termId: t.id, country, phrase: t.label, edited: false });
    }
    const foreign = missing.filter((c) => !isEnglish(c));
    if (t.mode === "localized" && foreign.length > 0) {
      const key = foreign.join(",");
      const group = groups.get(key) ?? {
        countries: foreign,
        termByLabel: new Map(),
      };
      group.termByLabel.set(t.label, t.id);
      groups.set(key, group);
    }
  }

  // Saved as they arrive, so a run cut short keeps what finished and a retry fills the rest
  const total = await savePhrases(rows);
  let failure: unknown;
  for (const { countries, termByLabel } of groups.values()) {
    try {
      await localize([...termByLabel.keys()], countries, async (results) => {
        const chunk = results.flatMap((r) => {
          const termId = termByLabel.get(r.label);
          return termId === undefined
            ? []
            : [{ termId, country: r.country, phrase: r.phrase, edited: false }];
        });
        const { saved, queued } = await savePhrases(chunk);
        total.saved += saved;
        total.queued += queued;
      });
    } catch (e) {
      failure ??= e;
    }
  }
  if (total.saved === 0 && failure !== undefined) throw failure;
  return { localized: total.saved, queued: total.queued };
}

/**
 * Insert terms, or bring back existing ones (unhidden and undeleted). A
 * localized row upgrades an existing term to localized; other modes keep theirs.
 */
async function upsertTerms(
  appId: number,
  rows: { label: string; mode: TermMode }[],
) {
  return db
    .insert(terms)
    .values(rows.map((r) => ({ appId, ...r })))
    .onConflictDoUpdate({
      target: [terms.appId, terms.label],
      set: {
        hidden: false,
        deletedAt: null,
        mode: sql`case when excluded.mode = 'localized' then excluded.mode else terms.mode end`,
      },
    })
    .returning({ id: terms.id, label: terms.label });
}

/** Non-deleted terms of the app among the labels. */
async function liveTermCount(appId: number, labels: string[]) {
  const rows = await db
    .select({ id: terms.id })
    .from(terms)
    .where(
      and(
        eq(terms.appId, appId),
        isNull(terms.deletedAt),
        inArray(terms.label, labels),
      ),
    );
  return rows.length;
}

export type AddTermsInput = { labels: string[]; localize: boolean };

/**
 * Add English keywords (normalised, at most 100). localize makes them
 * localized (AI phrases in every storefront), else english. Existing ones are
 * unhidden and undeleted. Then queue their kept phrases and fill the missing ones.
 */
export async function addTerms(
  appId: number,
  input: AddTermsInput,
): Promise<{
  added: number;
  existing: number;
  phrases: number;
  queued: number;
}> {
  const { labels: raw, localize: localized } = parse(
    z.object({ labels: z.array(z.string()), localize: z.boolean() }),
    input,
  );
  const labels = [...new Set(raw.map(normalize).filter(Boolean))];
  if (labels.length === 0) throw new UserError("Enter at least one keyword");
  if (labels.length > MAX_TERMS) {
    throw new UserError(`Add at most ${MAX_TERMS} keywords at a time`);
  }
  if (labels.some((l) => l.length > MAX_PHRASE_LENGTH)) {
    throw new UserError(`Keep keywords under ${MAX_PHRASE_LENGTH} characters`);
  }
  await appRow(appId);
  const existing = await liveTermCount(appId, labels);
  const mode: TermMode = localized ? "localized" : "english";
  const saved = await upsertTerms(
    appId,
    labels.map((label) => ({ label, mode })),
  );
  const ids = saved.map((t) => t.id);
  const kept = await queueKept(appId, { termIds: ids });
  const filled = await localizeMissing(appId, ids);
  return {
    added: saved.length - existing,
    existing,
    phrases: filled.localized,
    queued: kept + filled.queued,
  };
}

/**
 * Track brainstorm keywords on an app. A phrase from an English storefront
 * becomes a label (localized or english per `localize`) keeping that keyword
 * for its storefront; any other becomes a manual term labelled with the phrase,
 * with the phrase as its edited row. Then fill the missing phrases.
 */
export async function trackPhrases(
  appId: number,
  input: { keywordIds: number[]; localize: boolean },
): Promise<{ added: number; queued: number }> {
  const parsed = parse(
    z.object({
      keywordIds: z
        .array(z.number().int().positive())
        .min(1, "Pick at least one keyword")
        .max(MAX_TERMS, `Track at most ${MAX_TERMS} keywords at a time`),
      localize: z.boolean(),
    }),
    input,
  );
  await appRow(appId);
  const ids = [...new Set(parsed.keywordIds)];
  const found = await db
    .select({
      id: keywords.id,
      phrase: keywords.phrase,
      country: keywords.country,
    })
    .from(keywords)
    .where(inArray(keywords.id, ids));
  if (found.length !== ids.length) {
    throw new UserError("Some keywords no longer exist");
  }

  const byLabel = new Map<
    string,
    {
      mode: TermMode;
      phrases: { country: string; phrase: string; edited: boolean }[];
    }
  >();
  for (const k of found) {
    const label = normalize(k.phrase);
    const english = isEnglish(k.country);
    const term = byLabel.get(label) ?? { mode: "manual", phrases: [] };
    if (english) term.mode = parsed.localize ? "localized" : "english";
    term.phrases.push({
      country: k.country,
      phrase: k.phrase,
      edited: !english,
    });
    byLabel.set(label, term);
  }

  const labels = [...byLabel.keys()];
  const existing = await liveTermCount(appId, labels);
  const saved = await upsertTerms(
    appId,
    labels.map((label) => ({
      label,
      mode: byLabel.get(label)?.mode ?? "manual",
    })),
  );
  const { queued } = await savePhrases(
    saved.flatMap((t) =>
      (byLabel.get(t.label)?.phrases ?? []).map((p) => ({
        termId: t.id,
        ...p,
      })),
    ),
  );
  const filled = await localizeMissing(
    appId,
    saved.map((t) => t.id),
  );
  return { added: saved.length - existing, queued: queued + filled.queued };
}

/**
 * Set a term's phrase in one storefront as the user's (edited), or clear it
 * with null so AI never refills it. The old keyword keeps its history; the new
 * one is queued unless checked in the last 20 hours.
 */
export async function setPhrase(
  appId: number,
  termId: number,
  country: string,
  phrase: string | null,
): Promise<void> {
  const parsed = parse(
    z.object({
      country: countrySchema,
      phrase: z
        .string()
        .transform(normalize)
        .pipe(
          z
            .string()
            .min(1, "Keywords cannot be empty")
            .max(
              MAX_PHRASE_LENGTH,
              `Keep keywords under ${MAX_PHRASE_LENGTH} characters`,
            ),
        )
        .nullable(),
    }),
    { country, phrase },
  );
  await researchedCountry(appId, parsed.country);
  const term = await termOf(appId, termId);
  if (parsed.phrase === null) {
    await db
      .insert(termPhrases)
      .values({
        termId: term.id,
        country: parsed.country,
        keywordId: null,
        edited: true,
      })
      .onConflictDoUpdate({
        target: [termPhrases.termId, termPhrases.country],
        set: { keywordId: null, edited: true, updatedAt: sql`now()` },
      });
    return;
  }
  await savePhrases([
    {
      termId: term.id,
      country: parsed.country,
      phrase: parsed.phrase,
      edited: true,
    },
  ]);
}

/**
 * Run AI again for one storefront of a term, replacing its phrase even when the
 * user cleared or edited it (edited is false after). English storefronts and
 * english terms get the label; manual terms are refused. The new phrase is
 * queued unless checked in the last 20 hours.
 */
export async function relocalizePhrase(
  termId: number,
  country: string,
): Promise<void> {
  const id = parse(z.number().int().positive(), termId);
  const [term] = await db
    .select({ appId: terms.appId, label: terms.label, mode: terms.mode })
    .from(terms)
    .where(and(eq(terms.id, id), isNull(terms.deletedAt)));
  if (!term) throw new UserError("Keyword not found");
  if (term.mode === "manual") {
    throw new UserError("Manual keywords are never localized");
  }
  const { country: code } = await researchedCountry(term.appId, country);
  // english terms keep the label, as localizeMissing gives them
  if (term.mode === "english") {
    await savePhrases(
      [{ termId: id, country: code, phrase: term.label, edited: false }],
      { overwrite: true },
    );
    return;
  }
  const result = (await localize([term.label], [code])).find(
    (r) => r.country === code,
  );
  if (!result) {
    throw new UserError("The AI returned no usable phrase. Try again.");
  }
  await savePhrases(
    [{ termId: id, country: code, phrase: result.phrase, edited: false }],
    { overwrite: true },
  );
}

/** The app's storefronts by how many visible terms have a phrase there, most first; ties keep the app's order. */
export async function countryWeights(appId: number): Promise<string[]> {
  const app = await appRow(appId);
  if (app.countries.length === 0) return [];
  const rows = await db
    .select({
      country: termPhrases.country,
      n: sql<number>`count(*)::int`,
    })
    .from(termPhrases)
    .innerJoin(terms, eq(terms.id, termPhrases.termId))
    .where(
      and(
        eq(terms.appId, appId),
        eq(terms.hidden, false),
        isNull(terms.deletedAt),
        isNotNull(termPhrases.keywordId),
        inArray(termPhrases.country, app.countries),
      ),
    )
    .groupBy(termPhrases.country);
  const count = new Map(rows.map((r) => [r.country, r.n]));
  // sort is stable, so equal counts stay in saved order
  return [...app.countries].sort(
    (a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0),
  );
}

const termIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "Pick at least one keyword")
  .max(1000);

/** Hidden terms keep their history but are not checked on schedule. */
export async function setHidden(
  appId: number,
  termIds: number[],
  hidden: boolean,
): Promise<void> {
  const ids = parse(termIdsSchema, termIds);
  const flag = parse(z.boolean(), hidden);
  await appRow(appId);
  await db
    .update(terms)
    .set({ hidden: flag })
    .where(
      and(
        eq(terms.appId, appId),
        isNull(terms.deletedAt),
        inArray(terms.id, ids),
      ),
    );
}

/** Soft delete; restoreTerms brings them back until cron purges them after a day. */
export async function deleteTerms(
  appId: number,
  termIds: number[],
): Promise<void> {
  const ids = parse(termIdsSchema, termIds);
  await appRow(appId);
  await db
    .update(terms)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(terms.appId, appId),
        isNull(terms.deletedAt),
        inArray(terms.id, ids),
      ),
    );
}

/** Undo of deleteTerms, within a day. */
export async function restoreTerms(
  appId: number,
  termIds: number[],
): Promise<void> {
  const ids = parse(termIdsSchema, termIds);
  await appRow(appId);
  await db
    .update(terms)
    .set({ deletedAt: null })
    .where(
      and(
        eq(terms.appId, appId),
        isNotNull(terms.deletedAt),
        inArray(terms.id, ids),
      ),
    );
}
