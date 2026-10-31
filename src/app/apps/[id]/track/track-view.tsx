"use client";

import {
  Avatar,
  buttonVariants,
  Link as HeroLink,
  ListBox,
  ScrollShadow,
  Select,
  Table,
  Tooltip,
  Typography,
} from "@heroui/react";
import { EmptyState, RadioButtonGroup, Segment } from "@heroui-pro/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getCountry } from "@/components/countries";
import { Metric } from "@/components/metric";
import { NextStepChip } from "@/components/next-step-chip";
import { RankChip } from "@/components/rank-chip";
import type { LosingTo, TrackRow } from "@/lib/terms";
import { LosingToCards } from "./losing-to";

export type CountryTrack = {
  country: string;
  top10: number;
  total: number;
  rows: TrackRow[];
  losingTo: (LosingTo & { ratings: number | null })[];
};

type Props = { appId: number; tracks: CountryTrack[] };

type View = "country" | "keyword";

/** Country cards, then one country's keywords (or one keyword's countries), then who is ahead there. */
export function TrackView({ appId, tracks }: Props) {
  const searchParams = useSearchParams();

  // State lives in the URL; replaceState keeps it in sync without a server round trip
  const setParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `?${query}` : window.location.pathname,
    );
  };

  const selected =
    tracks.find((t) => t.country === searchParams.get("country")) ?? tracks[0];
  if (!selected || tracks.every((t) => t.total === 0)) {
    return <NoKeywords appId={appId} hasCountries={tracks.length > 0} />;
  }
  const view: View =
    searchParams.get("view") === "keyword" ? "keyword" : "country";

  // Each keyword once, for the By Keyword picker
  const terms = [
    ...new Map(
      tracks.flatMap((t) => t.rows.map((r) => [r.termId, r.label] as const)),
    ),
  ]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const termParam = Number(searchParams.get("keyword"));
  const termId = terms.some((t) => t.id === termParam)
    ? termParam
    : (selected.rows[0]?.termId ?? terms[0]?.id);

  return (
    <div className="flex flex-col gap-6">
      <ScrollShadow orientation="horizontal">
        <div className="p-1">
          <RadioButtonGroup
            aria-label="Countries"
            value={selected.country}
            onChange={(country) => setParams({ country })}
          >
            {tracks.map((t) => {
              const { flag, name } = getCountry(t.country);
              return (
                <RadioButtonGroup.Item key={t.country} value={t.country}>
                  <RadioButtonGroup.ItemContent>
                    <span className="whitespace-nowrap font-medium">
                      <span aria-hidden="true">{flag}</span> {name}
                    </span>
                    <span className="whitespace-nowrap text-sm text-muted tabular-nums">
                      {t.top10}/{t.total} in the top 10
                    </span>
                  </RadioButtonGroup.ItemContent>
                </RadioButtonGroup.Item>
              );
            })}
          </RadioButtonGroup>
        </div>
      </ScrollShadow>

      <div className="flex flex-wrap items-center gap-3">
        <Segment
          aria-label="View"
          selectedKey={view}
          onSelectionChange={(key) =>
            setParams({ view: key === "keyword" ? "keyword" : null })
          }
        >
          <Segment.Item id="country">By Country</Segment.Item>
          <Segment.Item id="keyword">By Keyword</Segment.Item>
        </Segment>
        {view === "keyword" && termId !== undefined && (
          <div className="w-64 max-w-full">
            <Select
              aria-label="Keyword"
              value={termId}
              onChange={(key) =>
                key !== null && setParams({ keyword: String(key) })
              }
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox items={terms}>
                  {(t) => (
                    <ListBox.Item id={t.id} textValue={t.label}>
                      {t.label}
                    </ListBox.Item>
                  )}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        )}
      </div>

      {view === "country" ? (
        <TrackTable
          appId={appId}
          label={`Keywords in ${getCountry(selected.country).name}`}
          rows={selected.rows.map((r) => ({ ...r, country: selected.country }))}
          showCountry={false}
        />
      ) : (
        <TrackTable
          appId={appId}
          label={`${terms.find((t) => t.id === termId)?.label ?? "Keyword"} by country`}
          rows={tracks.flatMap((t) =>
            t.rows
              .filter((r) => r.termId === termId)
              .map((r) => ({ ...r, country: t.country })),
          )}
          showCountry
        />
      )}

      <section className="flex flex-col gap-4">
        <Typography.Heading level={2}>
          Losing To in {getCountry(selected.country).name}
        </Typography.Heading>
        <LosingToCards
          appId={appId}
          country={selected.country}
          losingTo={selected.losingTo}
        />
      </section>
    </div>
  );
}

type Row = TrackRow & { country: string };

function TrackTable({
  appId,
  label,
  rows,
  showCountry,
}: {
  appId: number;
  label: string;
  rows: Row[];
  showCountry: boolean;
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            {showCountry ? (
              <Table.Column isRowHeader>Country</Table.Column>
            ) : null}
            <Table.Column isRowHeader={!showCountry}>Keyword</Table.Column>
            <Table.Column>Rank</Table.Column>
            <Table.Column>Volume</Table.Column>
            <Table.Column>Difficulty</Table.Column>
            <Table.Column>Top 5</Table.Column>
            <Table.Column>Next Step</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <p className="text-muted">No keywords checked here yet.</p>
            )}
          >
            {rows.map((r) => {
              const { flag, name } = getCountry(r.country);
              return (
                <Table.Row
                  key={`${r.country}:${r.keywordId}`}
                  id={`${r.country}:${r.keywordId}`}
                >
                  {showCountry ? (
                    <Table.Cell>
                      <span className="whitespace-nowrap">
                        <span aria-hidden="true">{flag}</span> {name}
                      </span>
                    </Table.Cell>
                  ) : null}
                  <Table.Cell>
                    <HeroLink href={`/apps/${appId}/k/${r.termId}`}>
                      {r.phrase}
                    </HeroLink>
                    {r.phrase !== r.label && (
                      <span className="text-muted"> {r.label}</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex items-center gap-1">
                      <RankChip rank={r.rank} />
                      <RankMove change={r.rankChange} />
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Metric kind="volume" value={r.volume} />
                  </Table.Cell>
                  <Table.Cell>
                    <Metric kind="difficulty" value={r.difficulty} />
                  </Table.Cell>
                  <Table.Cell>
                    <TopApps apps={r.top5} />
                  </Table.Cell>
                  <Table.Cell>
                    {r.nextStep ? (
                      <NextStepChip step={r.nextStep} />
                    ) : (
                      <span className="text-muted">
                        <span aria-hidden="true">–</span>
                        <span className="sr-only">No next step</span>
                      </span>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** Small arrow and places moved for a rank change since the last check; positive is better. */
function RankMove({ change }: { change: number | null }) {
  if (!change) return null;
  const up = change > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-sm tabular-nums ${up ? "text-success" : "text-danger"}`}
    >
      <svg
        aria-hidden="true"
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable={false}
      >
        <path d={up ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M19 12l-7 7-7-7"} />
      </svg>
      <span className="sr-only">{up ? "Up " : "Down "}</span>
      {Math.abs(change)}
      <span className="sr-only"> since the last check</span>
    </span>
  );
}

function TopApps({ apps }: { apps: TrackRow["top5"] }) {
  if (apps.length === 0) {
    return (
      <span className="text-muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not checked</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {apps.map((a, i) => (
        <Tooltip key={a.id}>
          <Tooltip.Trigger aria-label={`${i + 1}. ${a.name}`}>
            <Avatar size="sm">
              <Avatar.Image src={a.icon} alt="" />
              <Avatar.Fallback>{a.name.slice(0, 1)}</Avatar.Fallback>
            </Avatar>
          </Tooltip.Trigger>
          <Tooltip.Content>
            {i + 1}. {a.name}
          </Tooltip.Content>
        </Tooltip>
      ))}
    </span>
  );
}

function NoKeywords({
  appId,
  hasCountries,
}: {
  appId: number;
  hasCountries: boolean;
}) {
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>
          {hasCountries ? "No Keywords Tracked Yet" : "No Countries Yet"}
        </EmptyState.Title>
        <EmptyState.Description>
          {hasCountries
            ? "Add keywords, and each country will show where you rank and who is ahead after the first check."
            : "Add a country on the Board to see where you rank in it and who is ahead."}
        </EmptyState.Description>
      </EmptyState.Header>
      <EmptyState.Content>
        {/* Track hides the country bar, so countries are added on the Board */}
        <Link
          href={`/apps/${appId}/${hasCountries ? "keywords" : "board"}`}
          className={buttonVariants()}
        >
          {hasCountries ? "Add Keywords" : "Add Country"}
        </Link>
      </EmptyState.Content>
    </EmptyState>
  );
}
