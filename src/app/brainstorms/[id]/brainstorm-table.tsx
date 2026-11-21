"use client";

import { Avatar, Button, Card, Chip, Table, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { recheckBrainstormAction } from "@/actions/brainstorms";
import { getCountry } from "@/components/countries";
import { MetricLabel } from "@/components/metric";
import type { IdeaVerdict, Verdict } from "@/lib/scoring";

export type BrainstormRow = {
  keywordId: number;
  country: string;
  phrase: string;
  volume: number | null;
  difficulty: number | null;
  queued: boolean;
};

const REFRESH_MS = 5000;

/** The brainstorm's phrases with their latest scores; refreshes while checks are queued. */
export function BrainstormTable({ rows }: { rows: BrainstormRow[] }) {
  const router = useRouter();
  const hasQueued = rows.some((r) => r.queued);

  useEffect(() => {
    if (!hasQueued) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasQueued, router]);

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Brainstorm keywords">
          <Table.Header>
            <Table.Column isRowHeader>Keyword</Table.Column>
            <Table.Column>Country</Table.Column>
            <Table.Column>
              <MetricLabel kind="volume" />
            </Table.Column>
            <Table.Column>
              <MetricLabel kind="difficulty" />
            </Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => {
              const { flag, name } = getCountry(r.country);
              return (
                <Table.Row key={r.keywordId} id={r.keywordId}>
                  <Table.Cell>{r.phrase}</Table.Cell>
                  <Table.Cell>
                    <span aria-hidden="true">{flag}</span> {name}
                  </Table.Cell>
                  <Table.Cell>
                    <Score value={r.volume} queued={r.queued} />
                  </Table.Cell>
                  <Table.Cell>
                    <Score value={r.difficulty} queued={r.queued} />
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

function Score({ value, queued }: { value: number | null; queued: boolean }) {
  if (value === null) {
    return (
      <span className="text-muted">{queued ? "Checking…" : "Not checked"}</span>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

const VERDICTS: Record<
  Verdict,
  { label: string; color: "success" | "accent" | "default" | "warning" }
> = {
  "worth-building": { label: "Worth Building", color: "success" },
  "worth-a-look": { label: "Worth a Look", color: "accent" },
  "tough-market": { label: "Tough Market", color: "warning" },
  "little-demand": { label: "Little Demand", color: "default" },
  checking: { label: "Checking…", color: "default" },
  unknown: { label: "Unknown", color: "default" },
};

const compact = new Intl.NumberFormat("en", { notation: "compact" });
const monthYear = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Verdict per storefront with its reasons, top searched phrases and the apps to compete with, plus Check again. */
export function IdeaVerdicts({
  brainstormId,
  verdicts,
}: {
  brainstormId: number;
  verdicts: ({ country: string } & IdeaVerdict)[];
}) {
  const [isPending, startTransition] = useTransition();
  const recheck = () => {
    startTransition(async () => {
      const res = await recheckBrainstormAction(brainstormId);
      if (res.error !== undefined) toast.danger(res.error);
      else if (res.data === 0)
        toast("All phrases were checked in the last hour");
      else
        toast.success(
          `Checking ${res.data} ${res.data === 1 ? "phrase" : "phrases"} again`,
        );
    });
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="verdict-heading">
      <div className="flex items-center justify-between gap-4">
        <h2 id="verdict-heading" className="font-semibold text-lg">
          Worth Building?
        </h2>
        <Button variant="outline" isPending={isPending} onPress={recheck}>
          Check Again
        </Button>
      </div>
      <div className="grid gap-4">
        {verdicts.map((v) => (
          <VerdictCard key={v.country} {...v} />
        ))}
      </div>
    </section>
  );
}

function VerdictCard({
  country,
  verdict,
  reasons,
  searched,
  competitors,
}: { country: string } & IdeaVerdict) {
  const { flag, name } = getCountry(country);
  const { label, color } = VERDICTS[verdict];
  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between gap-3">
          <Card.Title>
            <span aria-hidden="true">{flag}</span> {name}
          </Card.Title>
          <Chip color={color} variant="soft">
            {label}
          </Chip>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <ul className="list-disc space-y-1 pl-5">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {searched.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-sm">Most Searched</h3>
            <div className="flex flex-wrap gap-2">
              {searched.slice(0, 5).map((s) => (
                <Chip key={s.phrase} size="sm" variant="soft">
                  {s.phrase}{" "}
                  <span className="tabular-nums text-muted">{s.demand}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}
        {competitors.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-sm">Who You Would Compete With</h3>
            <ul className="flex flex-col gap-3">
              {competitors.map(({ app, phrases }) => (
                <li key={app.id} className="flex items-center gap-3">
                  <Avatar size="sm">
                    <Avatar.Image src={app.icon} alt="" />
                    <Avatar.Fallback>{app.name.slice(0, 1)}</Avatar.Fallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{app.name}</p>
                    <p className="text-muted text-sm">
                      <span className="tabular-nums">
                        {app.ratings > 0
                          ? `${app.avg.toFixed(1)}★ · ${compact.format(app.ratings)} ratings`
                          : "No ratings"}
                      </span>
                      {app.updated && (
                        <>
                          {" · "}Updated{" "}
                          {monthYear.format(new Date(app.updated))}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-muted text-sm tabular-nums">
                    Top 10 for {phrases}/{searched.length}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
