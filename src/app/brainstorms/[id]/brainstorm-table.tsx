"use client";

import {
  Avatar,
  Button,
  buttonVariants,
  Card,
  Chip,
  Label,
  ListBox,
  ProgressBar,
  Select,
  Table,
  Typography,
  toast,
} from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { recheckBrainstormAction } from "@/actions/brainstorms";
import { addTermsAction } from "@/actions/terms";
import { getCountry } from "@/components/countries";
import { MetricLabel } from "@/components/metric";
import type { IdeaVerdict, Verdict } from "@/lib/scoring";

export type BrainstormRow = {
  keywordId: number;
  country: string;
  phrase: string;
  volume: number | null;
  difficulty: number | null;
  /** Has a check, even when Demand was not measured */
  checked: boolean;
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

  const done = rows.filter((r) => !r.queued).length;

  return (
    <div className="flex flex-col gap-3">
      {hasQueued && (
        <ProgressBar
          value={done}
          maxValue={rows.length}
          valueLabel={`${done} of ${rows.length}`}
        >
          <Label>Checking keywords</Label>
          <ProgressBar.Output>
            <span className="tabular-nums">
              {done} of {rows.length}
            </span>
          </ProgressBar.Output>
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      )}
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
                      <Score
                        value={r.volume}
                        queued={r.queued}
                        checked={r.checked}
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Score
                        value={r.difficulty}
                        queued={r.queued}
                        checked={r.checked}
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

const MAX_ADD = 100;

/** What to do with the result: put the phrases on one of your apps, or test another idea. */
export function BrainstormNext({
  phrases,
  apps,
}: {
  phrases: string[];
  apps: { trackId: number; name: string }[];
}) {
  const router = useRouter();
  const [appId, setAppId] = useState<number | null>(apps[0]?.trackId ?? null);
  const [isPending, startTransition] = useTransition();
  const labels = phrases.slice(0, MAX_ADD);

  const add = () => {
    if (appId === null) return;
    startTransition(async () => {
      const res = await addTermsAction(appId, { labels, localize: true });
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      router.push(`/apps/${appId}/keywords`);
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(labels.join("\n"));
      toast.success(`Copied ${labels.length} keywords`);
    } catch {
      toast.danger("Could not copy. Select the keywords in the table instead.");
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="next-heading">
      <Typography.Heading level={2} id="next-heading">
        What Next
      </Typography.Heading>
      {apps.length > 0 ? (
        <>
          <Typography.Paragraph size="sm" color="muted">
            Add these {labels.length} keywords to one of your apps. RankCrumb
            writes them for each of its countries and starts to check ranks.
          </Typography.Paragraph>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64 max-w-full">
              <Select
                value={appId}
                onChange={(key) => key !== null && setAppId(Number(key))}
              >
                <Label>Your app</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox items={apps.map((a) => ({ ...a, id: a.trackId }))}>
                    {(a) => (
                      <ListBox.Item id={a.trackId} textValue={a.name}>
                        {a.name}
                      </ListBox.Item>
                    )}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <Button isPending={isPending} onPress={add}>
              {isPending ? "Adding Keywords…" : "Add Keywords to App"}
            </Button>
          </div>
        </>
      ) : (
        <Typography.Paragraph size="sm" color="muted">
          When your app is on the App Store, add it from New, then add these
          keywords on its Keywords tab.
        </Typography.Paragraph>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onPress={copy}>
          Copy Keywords
        </Button>
        <Link href="/" className={buttonVariants({ variant: "ghost" })}>
          Test Another Idea
        </Link>
      </div>
    </section>
  );
}

function Score({
  value,
  queued,
  checked,
}: {
  value: number | null;
  queued: boolean;
  checked: boolean;
}) {
  if (value === null) {
    return (
      <span className="text-muted">
        {queued ? "Checking…" : checked ? "—" : "Not checked"}
      </span>
    );
  }
  return <span className="tabular-nums">{value}</span>;
}

const VERDICTS: Record<
  Verdict,
  {
    label: string;
    color: "success" | "default" | "warning" | "danger";
    variant: "soft" | "tertiary";
  }
> = {
  // Accent stays for actions; pending states are quieter than results
  "worth-building": {
    label: "Worth Building",
    color: "success",
    variant: "soft",
  },
  "worth-a-look": { label: "Worth a Look", color: "default", variant: "soft" },
  "tough-market": { label: "Tough Market", color: "warning", variant: "soft" },
  "little-demand": {
    label: "Little Demand",
    color: "danger",
    variant: "soft",
  },
  checking: { label: "Checking…", color: "default", variant: "tertiary" },
  unknown: { label: "Unknown", color: "default", variant: "tertiary" },
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
        <Typography.Heading level={2} id="verdict-heading">
          Worth Building?
        </Typography.Heading>
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
  const { label, color, variant } = VERDICTS[verdict];
  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between gap-3">
          <Card.Title>
            <span aria-hidden="true">{flag}</span> {name}
          </Card.Title>
          <Chip color={color} variant={variant}>
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
                    Top 10 for {phrases} of {searched.length}
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
