"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { checkPairs, type State } from "@/app/actions";
import { Results } from "@/app/check/check-form";
import { type FormState, trackPairs } from "@/app/tracking/actions";
import { type IdeasState, suggestKeywords } from "./actions";

const MAX_CHECKS = 15;

const fieldClass =
  "w-full rounded-control text-base sm:text-sm border border-input bg-card px-2.5 py-1.5 outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "mb-1 block text-xs font-medium";
const buttonClass =
  "min-h-10 shrink-0 rounded-control bg-primary px-5 font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-8";
const secondaryClass =
  "min-h-10 shrink-0 rounded-control border border-border bg-card px-4 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-8";
const sectionHeadClass =
  "mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground";

type Pick = { pairs: { country: string; phrase: string }[]; appId: string };

export function IdeasForm({
  apps,
}: {
  apps: { trackId: number; name: string }[];
}) {
  const [description, setDescription] = useState("");
  const [countries, setCountries] = useState("us");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [appId, setAppId] = useState(apps[0] ? String(apps[0].trackId) : "");

  // Controlled fields keep their values when React resets the form after an action
  const [ideas, suggestAction, suggesting] = useActionState(
    async (prev: IdeasState, formData: FormData) => {
      const next = await suggestKeywords(prev, formData);
      if (!next.error) setSelected(new Set());
      return next;
    },
    { ideas: [] },
  );
  // Dispatched with the selection rather than submitted, so a form reset cannot clear the checkboxes
  const [checked, checkAction, checking] = useActionState(
    async (_prev: State & { withApp: boolean }, { pairs, appId }: Pick) => ({
      ...(await checkPairs(pairs, appId ? Number(appId) : null)),
      withApp: appId !== "",
    }),
    { rows: [], withApp: false },
  );
  const [tracked, trackAction, tracking] = useActionState(
    async (_prev: FormState, { pairs, appId }: Pick) =>
      trackPairs(Number(appId), pairs),
    {},
  );
  // Keys are "country:phrase"; normalised phrases never contain a colon
  const pick = (): Pick => ({
    pairs: [...selected].map((key) => ({
      country: key.slice(0, 2),
      phrase: key.slice(3),
    })),
    appId,
  });

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const stores = [...new Set(ideas.ideas.map((i) => i.country))];
  const busy = checking || tracking;

  return (
    <>
      <form
        action={suggestAction}
        className="rounded-card border border-border bg-card p-4 shadow-[0_1px_0_var(--border)]"
      >
        <div className="grid gap-4 sm:grid-cols-[3fr_1fr]">
          <div>
            <label htmlFor="description" className={labelClass}>
              App description
            </label>
            <textarea
              id="description"
              name="description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A habit tracker with streaks, reminders and a home screen widget."
              className={`${fieldClass} resize-y`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              What it does, who it is for, the problems it solves.
            </p>
          </div>
          <div>
            <label htmlFor="ideas-countries" className={labelClass}>
              Storefronts
            </label>
            <input
              id="ideas-countries"
              name="countries"
              type="text"
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="us de jp"
              className={`${fieldClass} font-mono uppercase placeholder:normal-case`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Up to 5 two-letter codes.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            AI suggests about 15 keywords for one storefront, 10 each for more.
          </p>
          <button type="submit" disabled={suggesting} className={buttonClass}>
            {suggesting ? "Thinking…" : "Suggest"}
          </button>
        </div>
      </form>

      {ideas.error && (
        <p
          role="alert"
          className="mt-6 rounded-control border border-destructive px-3 py-2 text-destructive"
        >
          {ideas.error}
        </p>
      )}

      {ideas.ideas.length === 0 ? (
        !ideas.error && (
          <div className="mt-6 rounded-card border border-dashed border-border px-4 py-10 text-center">
            <p className="font-medium">No ideas yet.</p>
            <p className="mt-1 text-muted-foreground">
              Describe the app, pick storefronts, then Suggest.
            </p>
          </div>
        )
      ) : (
        <div
          aria-busy={suggesting}
          className={`mt-6 rounded-card border border-border bg-card p-4 ${suggesting ? "opacity-60" : ""}`}
        >
          {stores.map((store) => (
            <fieldset key={store} className="mb-4">
              <legend className={`${sectionHeadClass} font-mono`}>
                {store}
              </legend>
              <div className="flex flex-wrap gap-2">
                {ideas.ideas
                  .filter((i) => i.country === store)
                  .map(({ phrase }) => {
                    const key = `${store}:${phrase}`;
                    const on = selected.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-control border px-2.5 ${on ? "border-primary bg-muted" : "border-border hover:bg-muted"}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(key)}
                          className="accent-primary"
                        />
                        {phrase}
                      </label>
                    );
                  })}
              </div>
            </fieldset>
          ))}

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
            <div className="min-w-48">
              <label htmlFor="ideas-app" className={labelClass}>
                Your app
              </label>
              {apps.length > 0 ? (
                <select
                  id="ideas-app"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">None</option>
                  {apps.map((a) => (
                    <option key={a.trackId} value={a.trackId}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <Link href="/tracking" className="underline">
                    Add your app
                  </Link>{" "}
                  to see placement and track keywords.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {selected.size} selected
                {selected.size > MAX_CHECKS && `, check at most ${MAX_CHECKS}`}
              </p>
              <button
                type="button"
                onClick={() => startTransition(() => trackAction(pick()))}
                disabled={busy || selected.size === 0 || appId === ""}
                className={secondaryClass}
              >
                {tracking ? "Adding…" : "Track selected"}
              </button>
              <button
                type="button"
                onClick={() => startTransition(() => checkAction(pick()))}
                disabled={
                  busy || selected.size === 0 || selected.size > MAX_CHECKS
                }
                className={buttonClass}
              >
                {checking ? "Checking…" : "Check selected"}
              </button>
            </div>
          </div>
          {tracked.error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {tracked.error}
            </p>
          )}
          {tracked.message && (
            <output className="mt-2 block text-xs text-muted-foreground">
              {tracked.message}
            </output>
          )}
        </div>
      )}

      {(checked.rows.length > 0 || checked.error) && (
        <Results state={checked} pending={checking} withApp={checked.withApp} />
      )}
    </>
  );
}
