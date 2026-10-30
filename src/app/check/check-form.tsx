"use client";

import { type ReactNode, useActionState, useState } from "react";
import {
  checkKeywords,
  localizeKeywords,
  type Row,
  type State,
} from "@/app/actions";

type Shown = State & { withApp: boolean };
type Mode = "check" | "localize";

const compact = new Intl.NumberFormat("en", { notation: "compact" });

const fieldClass =
  "w-full rounded-control text-base sm:text-sm border border-input bg-card px-2.5 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "mb-1 block text-xs font-medium";
const headClass =
  "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground";
const cellClass = "px-2 py-1.5 align-middle";

function Meter({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-6 text-right font-mono">{value}</span>
      <span
        aria-hidden="true"
        className="h-[3px] w-10 rounded-full bg-meter-track"
      >
        <span
          className="block h-full rounded-full bg-meter-fill"
          style={{ width: `${value}%` }}
        />
      </span>
    </span>
  );
}

function Placement({ rank }: { rank: number | null }) {
  if (rank === null) {
    return (
      <span
        role="img"
        aria-label="Not in the first 200 results"
        title="Not in the first 200 results"
        className="text-muted-foreground"
      >
        –
      </span>
    );
  }
  const tone =
    rank <= 10
      ? "font-semibold text-rank-top"
      : rank <= 50
        ? "text-rank-mid"
        : "text-rank-low";
  return <span className={`font-mono ${tone}`}>{rank}</span>;
}

function Difficulty({
  value,
  label,
}: {
  value: number;
  label: "open" | "contested" | "crowded";
}) {
  const tone =
    label === "open"
      ? "text-muted-foreground"
      : label === "contested"
        ? "text-foreground"
        : "font-semibold text-foreground";
  return (
    <span className="inline-flex items-center gap-2">
      <Meter value={value} />
      <span className={`text-[11px] uppercase tracking-[0.04em] ${tone}`}>
        {label}
      </span>
    </span>
  );
}

function ResultRow({
  row,
  withApp,
  withSeed,
}: {
  row: Row;
  withApp: boolean;
  withSeed: boolean;
}) {
  const phrase = (
    <>
      <td className={`${cellClass} font-medium`}>{row.phrase}</td>
      {withSeed && (
        <td className={`${cellClass} text-muted-foreground`}>{row.seed}</td>
      )}
    </>
  );
  const store = (
    <td className={`${cellClass} font-mono uppercase`}>{row.country}</td>
  );
  if (row.error !== undefined) {
    return (
      <tr className="border-t border-border hover:bg-muted">
        {phrase}
        {store}
        <td
          colSpan={withApp ? 5 : 4}
          className={`${cellClass} text-destructive`}
        >
          {row.error}
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-border hover:bg-muted">
      {phrase}
      {store}
      {withApp && (
        <td className={cellClass}>
          <Placement rank={row.rank} />
        </td>
      )}
      <td className={cellClass}>
        <Meter value={row.volume} />
      </td>
      <td className={cellClass}>
        <Difficulty value={row.difficulty} label={row.label} />
      </td>
      <td className={cellClass}>
        {row.leader ? (
          <span className="flex max-w-56 items-center gap-2">
            {/* biome-ignore lint/performance/noImgElement: tiny remote icon, no optimisation needed */}
            <img
              src={row.leader.icon}
              alt=""
              width={16}
              height={16}
              className="size-4 shrink-0 rounded-[4px]"
            />
            <span className="truncate" title={row.leader.name}>
              {row.leader.name}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className={`${cellClass} text-right font-mono`}>
        {row.medianRatings === null
          ? "–"
          : compact.format(Math.round(row.medianRatings))}
      </td>
    </tr>
  );
}

/** Error, throttle notice and the results table for a check run. */
export function Results({
  state,
  pending,
  withApp,
  empty,
}: {
  state: State;
  pending: boolean;
  withApp: boolean;
  /** Shown before anything has been checked */
  empty?: ReactNode;
}) {
  const throttled = state.rows.some(
    (r) => r.error?.includes("rate limited") ?? false,
  );
  const withSeed = state.rows.some((r) => r.seed !== undefined);
  const cachedCount = state.rows.filter(
    (r) => r.error === undefined && r.cached,
  ).length;

  return (
    <section aria-live="polite" aria-busy={pending} className="mt-6">
      {state.error && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-destructive px-3 py-2 text-destructive"
        >
          {state.error}
        </p>
      )}
      {throttled && (
        <output className="block mb-4 rounded-control bg-notice px-3 py-2 text-notice-foreground">
          Apple is throttling searches. Wait a minute, then run again. Rows
          already checked in the last 24 hours are still served.
        </output>
      )}
      {state.rows.length === 0 ? (
        !state.error && empty
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {state.rows.length} {state.rows.length === 1 ? "check" : "checks"}
            {cachedCount > 0 && `, ${cachedCount} from the last 24 hours`}
          </p>
          <div
            className={`relative overflow-x-auto rounded-card border border-border bg-card ${pending ? "opacity-60" : ""}`}
          >
            <table className="w-full min-w-[44rem] border-collapse text-[13px] tabular-nums">
              <thead>
                <tr>
                  <th scope="col" className={headClass}>
                    Phrase
                  </th>
                  {withSeed && (
                    <th scope="col" className={headClass}>
                      From
                    </th>
                  )}
                  <th scope="col" className={headClass}>
                    Store
                  </th>
                  {withApp && (
                    <th scope="col" className={headClass}>
                      Placement
                    </th>
                  )}
                  <th
                    scope="col"
                    className={headClass}
                    title="How hard the top 50 apps target this phrase. Not Apple search popularity."
                  >
                    Volume
                  </th>
                  <th
                    scope="col"
                    className={headClass}
                    title="Competition, from rating counts of the top 10 apps."
                  >
                    Difficulty
                  </th>
                  <th scope="col" className={headClass}>
                    Leader
                  </th>
                  <th scope="col" className={`${headClass} text-right`}>
                    Top-10 ratings
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <ResultRow
                    key={`${row.country}:${row.phrase}`}
                    row={row}
                    withApp={withApp}
                    withSeed={withSeed}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function CheckForm() {
  const [mode, setMode] = useState<Mode>("check");
  const [phrases, setPhrases] = useState("");
  const [countries, setCountries] = useState("us");
  const [appId, setAppId] = useState("");
  // Controlled fields keep their values when React resets the form after an action
  const [state, formAction, pending] = useActionState(
    async (prev: Shown, formData: FormData): Promise<Shown> => ({
      ...(await (formData.get("mode") === "localize"
        ? localizeKeywords
        : checkKeywords)(prev, formData)),
      withApp: String(formData.get("appId") ?? "").trim() !== "",
    }),
    { rows: [], withApp: false },
  );

  return (
    <>
      <form
        action={formAction}
        className="rounded-card border border-border bg-card p-4 shadow-[0_1px_0_var(--border)]"
      >
        <fieldset className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
          <legend className="sr-only">Mode</legend>
          {(
            [
              ["check", "Check phrases"],
              ["localize", "Localize from English"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-8 cursor-pointer items-center gap-2"
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="accent-primary"
              />
              <span className={mode === value ? "font-medium" : ""}>
                {label}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <div>
            <label htmlFor="phrases" className={labelClass}>
              {mode === "localize" ? "English seed phrases" : "Phrases"}
            </label>
            <textarea
              id="phrases"
              name="phrases"
              rows={4}
              value={phrases}
              onChange={(e) => setPhrases(e.target.value)}
              placeholder={"habit tracker\ndaily routine"}
              className={`${fieldClass} resize-y`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "localize"
                ? "One per line. AI writes 1 to 3 native search phrases for each storefront, then checks them."
                : "One per line, or separated by commas."}
            </p>
          </div>
          <div>
            <label htmlFor="countries" className={labelClass}>
              Storefronts
            </label>
            <input
              id="countries"
              name="countries"
              type="text"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="us gb de"
              className={`${fieldClass} font-mono uppercase placeholder:normal-case`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Two-letter codes, e.g. us gb de.
            </p>
          </div>
          <div>
            <label htmlFor="appId" className={labelClass}>
              Your app (optional)
            </label>
            <input
              id="appId"
              name="appId"
              type="text"
              inputMode="numeric"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              autoComplete="off"
              placeholder="App ID"
              className={`${fieldClass} font-mono`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Add the numeric ID to see where it places.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Up to 15 checks per run. Each new lookup takes about 4 seconds.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="min-h-10 rounded-control bg-primary px-5 font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-8"
          >
            {pending
              ? "Running…"
              : mode === "localize"
                ? "Localize and run"
                : "Run"}
          </button>
        </div>
      </form>

      <Results
        state={state}
        pending={pending}
        withApp={state.withApp}
        empty={
          <div className="rounded-card border border-dashed border-border px-4 py-10 text-center">
            <p className="font-medium">Nothing Checked Yet</p>
            <p className="mt-1 text-muted-foreground">
              Add a phrase per line, pick storefronts, then Run.
            </p>
          </div>
        }
      />
    </>
  );
}
