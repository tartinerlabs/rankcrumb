"use client";

import {
  Accordion,
  Button,
  Chip,
  Description,
  Disclosure,
  IconPlus,
  Label,
  Table,
  Tabs,
  TextArea,
  TextField,
  Typography,
  toast,
} from "@heroui/react";
import { TrendChip } from "@heroui-pro/react";
import { type ReactNode, useState } from "react";
import type { Key } from "react-aria-components";
import { proposeListingAction } from "@/actions/listing";
import { countryFlag } from "@/components/countries";
import { Metric } from "@/components/metric";
import type { ListingText } from "@/db/schema";
import {
  type Draft,
  ExportMenu,
  SaveToAppStoreConnect,
} from "./listing-actions";
import { ListingFields } from "./listing-fields";
import {
  DESCRIPTION_MAX,
  keywordFieldError,
  type LocaleGroup,
  localeLabel,
  PROMO_MAX,
  type Score,
  score,
  signed,
  titleCase,
} from "./score";

type Option = { id: string; label: string; listing: ListingText };

type Row = { listing: ListingText; edited: boolean };

type Props = {
  appId: number;
  main: LocaleGroup & { country: string };
  /** Other locales, at most 4 so a save stays within App Store Connect's 5 */
  others: LocaleGroup[];
  /** Locales left out by that limit */
  dropped: string[];
  /** Storefronts with no App Store locale mapped */
  unsupported: string[];
  source: "asc" | "public";
  version: string | null;
  missingEnv: string[] | null;
};

const flags = (countries: string[]) => countries.map(countryFlag).join(" ");

const isValid = (l: ListingText) =>
  l.name.trim() !== "" && keywordFieldError(l) === undefined;

export function OptimizeEditor({
  appId,
  main,
  others,
  dropped,
  unsupported,
  source,
  version,
  missingEnv,
}: Props) {
  const initial: Option = {
    id: "current",
    label: "Current",
    listing: main.current,
  };
  const [options, setOptions] = useState<Option[]>([initial]);
  const [selected, setSelected] = useState<Key>("current");
  const [chosen, setChosen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<Key>>(new Set(["names"]));
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      others.map((g) => [g.locale, { listing: g.current, edited: false }]),
    ),
  );
  const [promo, setPromo] = useState("");
  const [description, setDescription] = useState("");
  // "options" for step 1, "all" or a locale for step 2
  const [pending, setPending] = useState<Set<string>>(new Set());

  const now = score(main.current, main.phrases);
  const option = options.find((o) => o.id === selected) ?? initial;
  const chosenOption = options.find((o) => o.id === chosen);

  const track = async <T,>(key: string, fn: () => Promise<T>) => {
    setPending((p) => new Set(p).add(key));
    try {
      return await fn();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };

  const suggest = () =>
    track("options", async () => {
      const res = await proposeListingAction(appId, [main.country]);
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      if (res.data.warning) toast.warning(res.data.warning);
      const proposal = res.data.proposals[0];
      const nowCovered = new Set(now.covered.map((p) => p.phrase));
      const next = [...options];
      const seen = new Set(next.map((o) => JSON.stringify(o.listing)));
      const labels = new Set(next.map((o) => o.label));
      for (const o of proposal?.options ?? []) {
        const listing = {
          name: o.name,
          subtitle: o.subtitle,
          keywords: o.keywords,
        };
        const key = JSON.stringify(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        // Named after its most valuable phrase that the listing does not cover today
        const gained = score(listing, main.phrases).covered.find(
          (p) => !nowCovered.has(p.phrase),
        );
        let label = gained ? titleCase(gained.phrase) : "";
        if (!label || labels.has(label)) label = `Option ${next.length}`;
        labels.add(label);
        next.push({ id: `option-${next.length}`, label, listing });
      }
      if (next.length === options.length) {
        toast("No new options this time");
        return;
      }
      setOptions(next);
      setSelected(next[options.length].id);
    });

  const editOption = (listing: ListingText) =>
    setOptions((prev) =>
      prev.map((o) => (o.id === option.id ? { ...o, listing } : o)),
    );

  const use = () => {
    setChosen(option.id);
    setExpanded(new Set(others.length > 0 ? ["languages"] : ["extras"]));
  };

  const startOver = () => {
    setOptions([initial]);
    setSelected("current");
    setChosen(null);
    setExpanded(new Set(["names"]));
    setRows(
      Object.fromEntries(
        others.map((g) => [g.locale, { listing: g.current, edited: false }]),
      ),
    );
  };

  // AI writes each locale from its own best local phrases
  const writeLocales = (groups: LocaleGroup[], key: string) =>
    track(key, async () => {
      const targets = groups.filter((g) => g.country !== null);
      if (targets.length === 0) return;
      const res = await proposeListingAction(
        appId,
        targets.map((g) => g.country as string),
      );
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      if (res.data.warning) toast.warning(res.data.warning);
      setRows((prev) => {
        const next = { ...prev };
        for (const p of res.data.proposals) {
          const before = JSON.stringify(prev[p.locale]?.listing);
          // Regenerating prefers an option that differs from what is there
          const pick =
            p.options.find(
              (o) =>
                JSON.stringify({
                  name: o.name,
                  subtitle: o.subtitle,
                  keywords: o.keywords,
                }) !== before,
            ) ?? p.options[0];
          if (!pick) continue;
          next[p.locale] = {
            listing: {
              name: pick.name,
              subtitle: pick.subtitle,
              keywords: pick.keywords,
            },
            edited: true,
          };
        }
        return next;
      });
    });

  const drafts = (): Draft[] => [
    { locale: main.locale, ...(chosenOption ?? option).listing },
    ...others.flatMap((g) => {
      const row = rows[g.locale];
      return row?.edited ? [{ locale: g.locale, ...row.listing }] : [];
    }),
  ];
  const draftsValid = drafts().every(isValid);

  const optionScore = score(option.listing, main.phrases);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Typography.Heading level={2}>
            Listing in {localeLabel(main.locale)}
          </Typography.Heading>
          <Typography.Paragraph size="sm" color="muted">
            {source === "asc"
              ? "Current listing from App Store Connect."
              : missingEnv
                ? "Current listing is the public name only. Connect App Store Connect to load your subtitle and keyword field."
                : "App Store Connect could not be read, so the current listing is the public name only."}
          </Typography.Paragraph>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMenu
            data={() => ({
              drafts: drafts(),
              promotionalText: promo,
              description,
            })}
          />
          <SaveToAppStoreConnect
            appId={appId}
            drafts={drafts}
            version={version}
            missingEnv={missingEnv}
            isPrimary={chosen !== null}
            isDisabled={missingEnv === null && !draftsValid}
          />
        </div>
      </div>

      <Accordion
        allowsMultipleExpanded
        expandedKeys={expanded}
        onExpandedChange={setExpanded}
      >
        <Accordion.Item id="names">
          <Accordion.Heading>
            <Accordion.Trigger>
              1. Name, Subtitle and Keywords
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="flex flex-col gap-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Tabs selectedKey={selected} onSelectionChange={setSelected}>
                    <Tabs.ListContainer>
                      <Tabs.List aria-label="Listing options">
                        {options.map((o) => {
                          const change =
                            score(o.listing, main.phrases).reach - now.reach;
                          return (
                            <Tabs.Tab key={o.id} id={o.id}>
                              <span className="flex items-center gap-2">
                                {o.label}
                                {o.id !== "current" && (
                                  <TrendChip
                                    trend={
                                      change > 0
                                        ? "up"
                                        : change < 0
                                          ? "down"
                                          : "neutral"
                                    }
                                  >
                                    <span className="tabular-nums">
                                      {signed(change)}
                                    </span>
                                  </TrendChip>
                                )}
                              </span>
                              <Tabs.Indicator />
                            </Tabs.Tab>
                          );
                        })}
                      </Tabs.List>
                    </Tabs.ListContainer>
                  </Tabs>
                  <Button
                    variant={
                      options.length === 1 && chosen === null
                        ? "primary"
                        : "ghost"
                    }
                    isPending={pending.has("options")}
                    onPress={suggest}
                  >
                    {options.length === 1 ? (
                      "Suggest Options"
                    ) : (
                      <>
                        <IconPlus />
                        More Options
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_12rem]">
                  <ListingFields
                    showCoverage
                    listing={option.listing}
                    phrases={main.phrases}
                    onChange={editOption}
                  />
                  <div className="flex flex-wrap gap-6 lg:flex-col">
                    <Stat label="Reach" value={optionScore.reach}>
                      {option.id !== "current" && (
                        <TrendChip
                          trend={
                            optionScore.reach > now.reach
                              ? "up"
                              : optionScore.reach < now.reach
                                ? "down"
                                : "neutral"
                          }
                        >
                          <span className="tabular-nums">
                            {signed(optionScore.reach - now.reach)}
                          </span>
                        </TrendChip>
                      )}
                    </Stat>
                    <Stat
                      label="Competition"
                      value={
                        <Metric
                          kind="difficulty"
                          value={optionScore.difficulty}
                        />
                      }
                    >
                      {option.id !== "current" && (
                        <DifficultyChange now={now} next={optionScore} />
                      )}
                    </Stat>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Disclosure>
                    <Disclosure.Heading>
                      <Disclosure.Trigger>
                        Why This Works
                        <Disclosure.Indicator />
                      </Disclosure.Trigger>
                    </Disclosure.Heading>
                    <Disclosure.Content>
                      <Disclosure.Body>
                        <p className="text-sm">
                          {why(option, optionScore, now)}
                        </p>
                      </Disclosure.Body>
                    </Disclosure.Content>
                  </Disclosure>
                  <Disclosure>
                    <Disclosure.Heading>
                      <Disclosure.Trigger>
                        Phrases Covered ({optionScore.covered.length})
                        <Disclosure.Indicator />
                      </Disclosure.Trigger>
                    </Disclosure.Heading>
                    <Disclosure.Content>
                      <Disclosure.Body>
                        <PhraseList score={optionScore} />
                      </Disclosure.Body>
                    </Disclosure.Content>
                  </Disclosure>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={
                      chosen === null && options.length > 1
                        ? "primary"
                        : "outline"
                    }
                    isDisabled={
                      !isValid(option.listing) || chosen === option.id
                    }
                    onPress={use}
                  >
                    {chosen === option.id ? "In Use" : "Use This Option"}
                  </Button>
                  {(options.length > 1 || chosen !== null) && (
                    <Button variant="ghost" onPress={startOver}>
                      Start Over
                    </Button>
                  )}
                </div>
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="languages" isDisabled={chosen === null}>
          <Accordion.Heading>
            <Accordion.Trigger>
              2. Other Languages
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="flex flex-col gap-6">
                {others.length === 0 ? (
                  <p className="text-sm text-muted">
                    Every country in the bar uses {localeLabel(main.locale)}, so
                    there is nothing else to write.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-muted">
                        Each language is written from its own best local
                        phrases. Countries sharing a language share one listing.
                      </p>
                      <Button
                        variant="outline"
                        isPending={pending.has("all")}
                        onPress={() => writeLocales(others, "all")}
                      >
                        Write All Languages
                      </Button>
                    </div>
                    {others.map((g) => {
                      const row = rows[g.locale];
                      if (!row) return null;
                      const s = score(row.listing, g.phrases);
                      return (
                        <section
                          key={g.locale}
                          aria-label={localeLabel(g.locale)}
                          className="flex flex-col gap-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span aria-hidden="true">
                                {flags(g.countries)}
                              </span>
                              <span className="font-medium">
                                {localeLabel(g.locale)}
                              </span>
                              <span className="text-sm text-muted">
                                Reach{" "}
                                <span className="tabular-nums">{s.reach}</span>
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              isDisabled={g.country === null}
                              isPending={pending.has(g.locale)}
                              onPress={() => writeLocales([g], g.locale)}
                            >
                              {row.edited ? "Regenerate" : "Write"}
                            </Button>
                          </div>
                          {g.country === null && (
                            <p className="text-sm text-muted">
                              No keywords tracked in{" "}
                              {g.countries.join(", ").toUpperCase()} yet, so the
                              AI has nothing to write from.
                            </p>
                          )}
                          <ListingFields
                            listing={row.listing}
                            phrases={g.phrases}
                            onChange={(listing) =>
                              setRows((prev) => ({
                                ...prev,
                                [g.locale]: { listing, edited: true },
                              }))
                            }
                          />
                        </section>
                      );
                    })}
                  </>
                )}
                {dropped.length > 0 && (
                  <p className="text-sm text-muted">
                    App Store Connect saves up to 5 languages at once, so{" "}
                    {dropped.map(localeLabel).join(", ")} wait for a later save.
                  </p>
                )}
                {unsupported.length > 0 && (
                  <p className="text-sm text-muted">
                    No App Store language is mapped for{" "}
                    {unsupported.join(", ").toUpperCase()}.
                  </p>
                )}
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item id="extras">
          <Accordion.Heading>
            <Accordion.Trigger>
              3. Promotional Text and Description
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  Optional. These do not affect search ranking. They are
                  included in Export but not saved to App Store Connect yet.
                </p>
                <LongField
                  label="Promotional Text"
                  max={PROMO_MAX}
                  value={promo}
                  onChange={setPromo}
                />
                <LongField
                  label="Description"
                  max={DESCRIPTION_MAX}
                  value={description}
                  onChange={setDescription}
                />
              </div>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {children}
      </div>
    </div>
  );
}

/** Lower difficulty is better, so the colour flips against the trend arrow convention. */
function DifficultyChange({ now, next }: { now: Score; next: Score }) {
  if (now.difficulty === null || next.difficulty === null) return null;
  const change = next.difficulty - now.difficulty;
  return (
    <Chip
      size="sm"
      variant="soft"
      color={change < 0 ? "success" : change > 0 ? "danger" : "default"}
    >
      <span className="tabular-nums">{signed(change)}</span>
    </Chip>
  );
}

function PhraseList({ score: s }: { score: Score }) {
  if (s.covered.length === 0) {
    return (
      <p className="text-sm text-muted">Covers no tracked keywords yet.</p>
    );
  }
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Covered keywords">
          <Table.Header>
            <Table.Column isRowHeader>Phrase</Table.Column>
            <Table.Column>Demand</Table.Column>
            <Table.Column>Competition</Table.Column>
          </Table.Header>
          <Table.Body>
            {s.covered.map((p) => (
              <Table.Row key={p.phrase} id={p.phrase}>
                <Table.Cell>{p.phrase}</Table.Cell>
                <Table.Cell>
                  <Metric kind="volume" value={p.volume} />
                </Table.Cell>
                <Table.Cell>
                  <Metric kind="difficulty" value={p.difficulty} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function LongField({
  label,
  max,
  value,
  onChange,
}: {
  label: string;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <TextField fullWidth maxLength={max} value={value} onChange={onChange}>
        <Label>{label}</Label>
        <TextArea />
        <Description>
          <span className="tabular-nums">
            {value.length}/{max}
          </span>
        </Description>
      </TextField>
      <div>
        <Button variant="outline" isDisabled>
          Improve with AI
        </Button>
      </div>
    </div>
  );
}

/** Plain reasons from the numbers; the AI does not return its own rationale. */
function why(option: Option, s: Score, now: Score): string {
  if (option.id === "current") {
    return `This is your listing today. It covers ${s.covered.length} tracked ${s.covered.length === 1 ? "keyword" : "keywords"} with a reach of ${s.reach}.`;
  }
  const before = new Set(now.covered.map((p) => p.phrase));
  const after = new Set(s.covered.map((p) => p.phrase));
  const gained = s.covered.filter((p) => !before.has(p.phrase));
  const lost = now.covered.filter((p) => !after.has(p.phrase));
  const parts = [
    `Covers ${s.covered.length} tracked ${s.covered.length === 1 ? "keyword" : "keywords"}, reach ${signed(s.reach - now.reach)} against today.`,
  ];
  if (gained.length > 0) {
    parts.push(
      `Adds ${gained
        .slice(0, 3)
        .map((p) => p.phrase)
        .join(
          ", ",
        )}${gained.length > 3 ? ` and ${gained.length - 3} more` : ""}.`,
    );
  }
  if (lost.length > 0) {
    parts.push(
      `Drops ${lost
        .slice(0, 3)
        .map((p) => p.phrase)
        .join(", ")}${lost.length > 3 ? ` and ${lost.length - 3} more` : ""}.`,
    );
  }
  return parts.join(" ");
}
