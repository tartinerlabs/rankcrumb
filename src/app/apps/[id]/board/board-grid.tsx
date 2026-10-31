"use client";

import { Link, Spinner } from "@heroui/react";
import {
  DataGrid,
  type DataGridColumn,
  type DataGridSortDescriptor,
  HoverCard,
} from "@heroui-pro/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getCountry } from "@/components/countries";
import { StarIcon } from "@/components/icons";
import { Metric } from "@/components/metric";
import { RankChip } from "@/components/rank-chip";
import type { BoardView, CellView, TermView } from "./data";
import { TopAppsList } from "./top-apps-list";

const REFRESH_MS = 5000;
const UNRANKED = 201;

type Group = "listing" | "ideas";

type Row =
  | { kind: "group"; group: Group; count: number; terms: Row[] }
  | { kind: "term"; term: TermView };

const rowId = (row: Row) =>
  row.kind === "group" ? `g:${row.group}` : `t:${row.term.id}`;

const rankOf = (t: TermView, country: string) =>
  t.cells[country]?.rank ?? UNRANKED;

// Default order: most top-10 countries first, then highest average volume
const byTop10ThenVolume = (a: TermView, b: TermView) =>
  b.top10 - a.top10 || (b.avgVolume ?? -1) - (a.avgVolume ?? -1);

function sortTerms(
  terms: TermView[],
  sort: DataGridSortDescriptor | undefined,
) {
  const list = [...terms];
  if (!sort?.column) return list.sort(byTop10ThenVolume);
  const dir = sort.direction === "descending" ? -1 : 1;
  const column = String(sort.column);
  if (column === "keyword") {
    return list.sort((a, b) => dir * a.label.localeCompare(b.label));
  }
  if (column === "top10") {
    return list.sort(
      (a, b) => dir * (a.top10 - b.top10) || byTop10ThenVolume(a, b),
    );
  }
  // Country columns: best rank first when ascending; unranked always last
  const country = column.slice(2);
  return list.sort((a, b) => {
    const ra = rankOf(a, country);
    const rb = rankOf(b, country);
    if (ra === UNRANKED || rb === UNRANKED) return ra - rb;
    return dir * (ra - rb) || byTop10ThenVolume(a, b);
  });
}

type Props = { appId: number; isMine: boolean; board: BoardView };

/** Every visible keyword against every app country, grouped by listing coverage. */
export function BoardGrid({ appId, isMine, board }: Props) {
  const router = useRouter();
  const [sort, setSort] = useState<DataGridSortDescriptor>();
  const [expanded, setExpanded] = useState<Set<string | number>>(
    () => new Set(["g:listing", "g:ideas"]),
  );
  const visible = useMemo(
    () => board.terms.filter((t) => !t.hidden),
    [board.terms],
  );
  const hasQueued = visible.some((t) =>
    Object.values(t.cells).some((c) => c.queued),
  );

  // Pick up new ranks while checks are queued
  useEffect(() => {
    if (!hasQueued) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasQueued, router]);

  const rows = useMemo(() => {
    const groups: Row[] = [];
    for (const group of ["listing", "ideas"] as const) {
      const terms = sortTerms(
        visible.filter((t) => t.group === group),
        sort,
      );
      if (terms.length === 0) continue;
      groups.push({
        kind: "group",
        group,
        count: terms.length,
        terms: terms.map((term) => ({ kind: "term", term })),
      });
    }
    return groups;
  }, [visible, sort]);

  const columns = useMemo<DataGridColumn<Row>[]>(
    () => [
      {
        id: "keyword",
        header: "Keyword",
        isRowHeader: true,
        allowsSorting: true,
        pinned: "start",
        minWidth: 200,
        cell: (row) =>
          row.kind === "group" ? (
            <span className="whitespace-nowrap">
              <span className="font-medium">
                {row.group === "listing"
                  ? isMine
                    ? "In Your Listing"
                    : "In Listing"
                  : "Ideas"}
              </span>{" "}
              <span className="text-muted tabular-nums">{row.count}</span>
            </span>
          ) : (
            <Link href={`/apps/${appId}/k/${row.term.id}`}>
              {row.term.label}
            </Link>
          ),
      },
      {
        id: "top10",
        header: "Top 10",
        allowsSorting: true,
        cell: (row) => (row.kind === "term" ? <Top10 term={row.term} /> : null),
      },
      ...board.countries.map<DataGridColumn<Row>>((code) => {
        const { flag, name } = getCountry(code);
        return {
          id: `c:${code}`,
          header: (
            <span className="whitespace-nowrap">
              <span aria-hidden="true">{flag}</span>{" "}
              <span aria-hidden="true">{code.toUpperCase()}</span>
              <span className="sr-only">{name}</span>
            </span>
          ),
          allowsSorting: true,
          cell: (row) =>
            row.kind === "term" ? (
              <BoardCell
                cell={row.term.cells[code]}
                country={code}
                appId={appId}
                isMine={isMine}
              />
            ) : null,
        };
      }),
    ],
    [board.countries, appId, isMine],
  );

  return (
    <DataGrid
      aria-label="Keyword board"
      data={rows}
      columns={columns}
      getRowId={rowId}
      getChildren={(row) => (row.kind === "group" ? row.terms : undefined)}
      expandedKeys={expanded}
      onExpandedChange={setExpanded}
      sortDescriptor={sort}
      onSortChange={setSort}
    />
  );
}

function Top10({ term }: { term: TermView }) {
  if (term.checked === 0) {
    const queued = Object.values(term.cells).some((c) => c.queued);
    return (
      <span className="whitespace-nowrap text-muted">
        {queued ? "Checking" : "–"}
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap tabular-nums">
      {term.top10}/{term.checked}
    </span>
  );
}

type CellProps = {
  cell: CellView | undefined;
  country: string;
  appId: number;
  isMine: boolean;
};

/**
 * Rank with competition and demand below; hover for the phrase and top apps.
 * The hover card trigger is not focusable, so the keyword page is the keyboard route.
 */
function BoardCell({ cell, country, appId, isMine }: CellProps) {
  if (!cell || cell.phrase === null) {
    return (
      <span className="text-muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">No phrase</span>
      </span>
    );
  }
  if (!cell.checked) {
    return cell.queued ? (
      <Spinner size="sm" color="current" aria-label="Checking" />
    ) : (
      <span className="text-muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not checked</span>
      </span>
    );
  }

  const { flag, name } = getCountry(country);
  const podium = cell.rank !== null && cell.rank <= 3;
  return (
    <HoverCard>
      <HoverCard.Trigger>
        <span className="flex flex-col items-start gap-1">
          <span className="flex items-center gap-1">
            <RankChip rank={cell.rank} />
            {podium && (
              <>
                <StarIcon width={12} height={12} className="text-success" />
                <span className="sr-only">Top 3</span>
              </>
            )}
            {cell.queued && (
              <Spinner size="sm" color="current" aria-label="Checking" />
            )}
          </span>
          <span className="whitespace-nowrap text-xs text-muted">
            C <Metric kind="difficulty" value={cell.difficulty} /> · D{" "}
            <Metric kind="volume" value={cell.volume} />
          </span>
          <span className="sr-only">Details on the keyword page</span>
        </span>
      </HoverCard.Trigger>
      <HoverCard.Content>
        <div className="flex w-72 flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              <span aria-hidden="true">{flag}</span> {name}
            </span>
            <span className="text-sm text-muted">{cell.phrase}</span>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Rank</dt>
              <dd>
                <RankChip rank={cell.rank} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Competition</dt>
              <dd>
                <Metric kind="difficulty" value={cell.difficulty} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Demand</dt>
              <dd>
                <Metric kind="volume" value={cell.volume} />
              </dd>
            </div>
          </dl>
          {cell.top.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted">Top Apps</span>
              <TopAppsList apps={cell.top} appId={appId} isMine={isMine} />
            </div>
          )}
        </div>
      </HoverCard.Content>
    </HoverCard>
  );
}
