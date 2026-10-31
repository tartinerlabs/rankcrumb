import {
  Accordion,
  Avatar,
  buttonVariants,
  Card,
  IconChevronLeft,
  Table,
  Typography,
} from "@heroui/react";
import { EmptyState } from "@heroui-pro/react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCountry } from "@/components/countries";
import { Metric, MetricLabel } from "@/components/metric";
import { RankChip } from "@/components/rank-chip";
import { TopAppsList } from "../../board/top-apps-list";
import { getWorkspaceApp } from "../../data";
import { type DetailCheck, loadKeywordDetail } from "./data";
import { RankChart, type RankRow } from "./rank-chart";

const DAY_MS = 86_400_000;

// Server-rendered, so dates read in UTC like the rest of the app's messages
const checkedAt = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default function KeywordPage({
  params,
}: PageProps<"/apps/[id]/k/[termId]">) {
  return (
    <Suspense fallback={null}>
      <KeywordDetailView params={params} />
    </Suspense>
  );
}

async function KeywordDetailView({
  params,
}: {
  params: Promise<{ id: string; termId: string }>;
}) {
  const { id, termId } = await params;
  const app = await getWorkspaceApp(id);
  if (!app || !/^\d{1,15}$/.test(termId)) notFound();
  const detail = await loadKeywordDetail(app.trackId, Number(termId));
  if (!detail) notFound();

  const first = detail.series[0]?.country;
  // Only storefronts ranked at least once get a line
  const ranked = detail.series.filter((s) =>
    s.checks.some((c) => c.rank !== null),
  );
  // One row per UTC day so storefronts share x values; checks are newest
  // first, so the first seen per day is that day's latest
  const byDay = new Map<number, RankRow>();
  for (const s of ranked) {
    const seen = new Set<number>();
    for (const c of s.checks) {
      const t = Math.floor(new Date(c.checkedAt).getTime() / DAY_MS) * DAY_MS;
      if (seen.has(t)) continue;
      seen.add(t);
      const row = byDay.get(t) ?? { t };
      if (c.rank !== null) row[s.country] = c.rank;
      byDay.set(t, row);
    }
  }
  const rows = [...byDay.values()].sort((a, b) => a.t - b.t);
  const chartSeries = ranked.map((s) => ({
    country: s.country,
    name: getCountry(s.country).name,
  }));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <Link
          href={`/apps/${app.trackId}/board`}
          className={buttonVariants({ variant: "ghost" })}
        >
          <IconChevronLeft />
          Board
        </Link>
        <Typography.Heading level={2}>{detail.label}</Typography.Heading>
        <Typography.Paragraph color="muted">
          Rank history and top apps for each country&apos;s local phrase.
        </Typography.Paragraph>
      </div>

      {detail.series.length === 0 ? (
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>No Phrases Yet</EmptyState.Title>
            <EmptyState.Description>
              This keyword has no local phrase in any country. Add one from the
              Keywords tab.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <>
          {chartSeries.length > 0 && (
            <Card>
              <Card.Header>
                <Card.Title id="rank-history-title">Rank History</Card.Title>
                <Card.Description id="rank-history-description">
                  Latest rank per country on each check day. Gaps are days
                  outside the top results or without a check. Each
                  country&apos;s table below lists every check.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <RankChart
                  rows={rows}
                  series={chartSeries}
                  labelledBy="rank-history-title"
                  describedBy="rank-history-description"
                />
              </Card.Content>
            </Card>
          )}
          <Accordion
            allowsMultipleExpanded
            defaultExpandedKeys={first ? [first] : []}
          >
            {detail.series.map((s) => {
              const { flag, name } = getCountry(s.country);
              const latest = s.checks[0];
              return (
                <Accordion.Item key={s.country} id={s.country}>
                  <Accordion.Heading>
                    <Accordion.Trigger>
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <span className="whitespace-nowrap">
                          <span aria-hidden="true">{flag}</span> {name}
                        </span>
                        <span className="text-muted">{s.phrase}</span>
                      </span>
                      {latest && <RankChip rank={latest.rank} />}
                      <Accordion.Indicator />
                    </Accordion.Trigger>
                  </Accordion.Heading>
                  <Accordion.Panel>
                    <Accordion.Body>
                      {latest ? (
                        <div className="flex flex-col gap-6">
                          <section className="flex max-w-md flex-col gap-2">
                            <Typography.Heading level={3}>
                              Latest Top Apps
                            </Typography.Heading>
                            <TopAppsList
                              apps={latest.top}
                              appId={app.trackId}
                              isMine={app.isMine}
                            />
                          </section>
                          <ChecksTable
                            label={`${name} checks`}
                            checks={s.checks}
                          />
                        </div>
                      ) : (
                        <Typography.Paragraph color="muted">
                          Not checked yet.
                        </Typography.Paragraph>
                      )}
                    </Accordion.Body>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        </>
      )}
    </div>
  );
}

function ChecksTable({
  label,
  checks,
}: {
  label: string;
  checks: DetailCheck[];
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            <Table.Column isRowHeader>Checked</Table.Column>
            <Table.Column>Rank</Table.Column>
            <Table.Column>
              <MetricLabel kind="volume" />
            </Table.Column>
            <Table.Column>
              <MetricLabel kind="difficulty" />
            </Table.Column>
            <Table.Column>Top Apps</Table.Column>
          </Table.Header>
          <Table.Body>
            {checks.map((c) => (
              <Table.Row key={c.checkedAt} id={c.checkedAt}>
                <Table.Cell>
                  <span className="whitespace-nowrap tabular-nums">
                    {checkedAt.format(new Date(c.checkedAt))} UTC
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <RankChip rank={c.rank} />
                </Table.Cell>
                <Table.Cell>
                  <Metric kind="volume" value={c.volume} />
                </Table.Cell>
                <Table.Cell>
                  <Metric kind="difficulty" value={c.difficulty} />
                </Table.Cell>
                <Table.Cell>
                  <span className="flex items-center gap-1">
                    {c.top.map((a) => (
                      <Avatar key={a.id} size="sm">
                        <Avatar.Image src={a.icon} alt={a.name} />
                        <Avatar.Fallback>{a.name.slice(0, 1)}</Avatar.Fallback>
                      </Avatar>
                    ))}
                  </span>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
