"use client";

import {
  Button,
  Chip,
  Description,
  Dropdown,
  Input,
  Label,
  Link,
  Popover,
  Spinner,
  TextField,
  Tooltip,
  toast,
} from "@heroui/react";
import {
  DataGrid,
  type DataGridColumn,
  type DataGridSortDescriptor,
  EmptyState,
} from "@heroui-pro/react";
import { useRouter } from "next/navigation";
import {
  type ClipboardEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  addTermsAction,
  deleteTermsAction,
  restoreTermsAction,
  setHiddenAction,
  setPhraseAction,
} from "@/actions/terms";
import { getCountry } from "@/components/countries";
import { Metric } from "@/components/metric";
import { RankChip } from "@/components/rank-chip";
import { normalize } from "@/lib/scoring";
import type { BoardView, CellView, TermView } from "../_board/data";

const REFRESH_MS = 5000;

type Group = "listing" | "ideas" | "hidden";

type Row =
  | { kind: "group"; group: Group; count: number; children: Row[] }
  | { kind: "term"; term: TermView; children: Row[] }
  | { kind: "country"; term: TermView; country: string; cell?: CellView };

const rowId = (row: Row) =>
  row.kind === "group"
    ? `g:${row.group}`
    : row.kind === "term"
      ? `t:${row.term.id}`
      : `c:${row.term.id}:${row.country}`;

const DEFAULT_SORT: DataGridSortDescriptor = {
  column: "avgVolume",
  direction: "descending",
};

// Unchecked values sort last in either direction
function compareNullable(a: number | null, b: number | null, dir: number) {
  if (a === null || b === null)
    return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return dir * (a - b);
}

function sortTerms(terms: TermView[], sort: DataGridSortDescriptor) {
  const dir = sort.direction === "descending" ? -1 : 1;
  const byLabel = (a: TermView, b: TermView) => a.label.localeCompare(b.label);
  const compare: (a: TermView, b: TermView) => number =
    sort.column === "keyword"
      ? (a, b) => dir * byLabel(a, b)
      : sort.column === "top10"
        ? (a, b) =>
            compareNullable(
              a.checked === 0 ? null : a.top10,
              b.checked === 0 ? null : b.top10,
              dir,
            ) || byLabel(a, b)
        : sort.column === "avgDifficulty"
          ? (a, b) =>
              compareNullable(a.avgDifficulty, b.avgDifficulty, dir) ||
              byLabel(a, b)
          : sort.column === "countries"
            ? (a, b) => dir * (a.countries - b.countries) || byLabel(a, b)
            : (a, b) =>
                compareNullable(a.avgVolume, b.avgVolume, dir) || byLabel(a, b);
  return [...terms].sort(compare);
}

/** Entries typed or pasted into the add bar: comma or line separated, normalised. */
const entriesOf = (text: string) => [
  ...new Set(text.split(/[,\n]/).map(normalize).filter(Boolean)),
];

type Props = { appId: number; isMine: boolean; board: BoardView };

/** Add bar plus the app's keywords grouped like the Board, with per-country phrases. */
export function KeywordsManager({ appId, isMine, board }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sort, setSort] = useState<DataGridSortDescriptor>(DEFAULT_SORT);
  const [expanded, setExpanded] = useState<Set<string | number>>(
    () => new Set(["g:listing", "g:ideas"]),
  );
  const [adding, setAdding] = useState<"localize" | "english" | null>(null);
  const [, startAdd] = useTransition();
  const { countries } = board;
  const entries = useMemo(() => entriesOf(text), [text]);
  const isFiltering = entries.length > 0;

  const hasQueued = board.terms.some((t) =>
    Object.values(t.cells).some((c) => c.queued),
  );
  // Pick up new phrases and ranks while checks are queued
  useEffect(() => {
    if (!hasQueued) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasQueued, router]);

  const rows = useMemo(() => {
    const matches = (t: TermView) =>
      entries.length === 0 || entries.some((e) => t.label.includes(e));
    const groups: Row[] = [];
    for (const group of ["listing", "ideas", "hidden"] as const) {
      const terms = sortTerms(
        board.terms.filter(
          (t) =>
            matches(t) &&
            (group === "hidden" ? t.hidden : !t.hidden && t.group === group),
        ),
        sort,
      );
      if (terms.length === 0) continue;
      groups.push({
        kind: "group",
        group,
        count: terms.length,
        children: terms.map((term) => ({
          kind: "term",
          term,
          children: countries.map((country) => ({
            kind: "country",
            term,
            country,
            cell: term.cells[country],
          })),
        })),
      });
    }
    return groups;
  }, [board.terms, countries, sort, entries]);

  // Filtering opens every group so duplicates show, Hidden included
  const expandedKeys = useMemo(
    () =>
      isFiltering
        ? new Set([...expanded, "g:listing", "g:ideas", "g:hidden"])
        : expanded,
    [expanded, isFiltering],
  );
  const exact = board.terms.filter((t) => entries.includes(t.label));

  const add = (localize: boolean) => {
    if (entries.length === 0) return;
    setAdding(localize ? "localize" : "english");
    startAdd(async () => {
      const res = await addTermsAction(appId, { labels: entries, localize });
      setAdding(null);
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      const { added, existing } = res.data;
      setText("");
      toast.success(
        added > 0
          ? `Added ${added} ${added === 1 ? "keyword" : "keywords"}`
          : `Already tracking ${existing === 1 ? "this keyword" : "these keywords"}`,
      );
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (countries.length > 0) add(true);
  };

  // A pasted list (one per line) becomes comma-separated entries in the one input
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!/[\r\n]/.test(pasted)) return;
    e.preventDefault();
    const lines = pasted
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    setText((current) => [current.trim(), ...lines].filter(Boolean).join(", "));
  };

  const columns = useMemo<DataGridColumn<Row>[]>(
    () => [
      {
        id: "keyword",
        header: "Keyword",
        isRowHeader: true,
        allowsSorting: true,
        cell: (row) => <KeywordCell appId={appId} row={row} isMine={isMine} />,
      },
      {
        id: "top10",
        header: "Top 10",
        allowsSorting: true,
        cell: (row) =>
          row.kind === "term" ? (
            <Top10 term={row.term} />
          ) : row.kind === "country" ? (
            <CountryRank cell={row.cell} />
          ) : null,
      },
      {
        id: "avgVolume",
        header: "Avg Volume",
        allowsSorting: true,
        cell: (row) =>
          row.kind === "term" ? (
            <Metric kind="volume" value={row.term.avgVolume} />
          ) : row.kind === "country" && row.cell?.checked ? (
            <Metric kind="volume" value={row.cell.volume} />
          ) : null,
      },
      {
        id: "avgDifficulty",
        header: "Avg Difficulty",
        allowsSorting: true,
        cell: (row) =>
          row.kind === "term" ? (
            <Metric kind="difficulty" value={row.term.avgDifficulty} />
          ) : row.kind === "country" && row.cell?.checked ? (
            <Metric kind="difficulty" value={row.cell.difficulty} />
          ) : null,
      },
      {
        id: "countries",
        header: "Countries",
        allowsSorting: true,
        cell: (row) =>
          row.kind === "term" ? (
            <span className="whitespace-nowrap tabular-nums">
              {row.term.countries}/{countries.length}
            </span>
          ) : null,
      },
      {
        id: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "end",
        cell: (row) =>
          row.kind === "term" ? (
            <TermActions
              appId={appId}
              term={row.term}
              total={countries.length}
            />
          ) : row.kind === "country" ? (
            <PhraseEditor
              appId={appId}
              term={row.term}
              country={row.country}
              cell={row.cell}
            />
          ) : null,
      },
    ],
    [appId, isMine, countries.length],
  );

  const localizeLabel = `Localize to ${countries.length} ${countries.length === 1 ? "Country" : "Countries"}`;

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        <div className="min-w-0 flex-1">
          <TextField
            fullWidth
            aria-label="English keyword"
            value={text}
            onChange={setText}
          >
            <Input
              placeholder="Add an English keyword, or paste a list"
              onPaste={onPaste}
            />
            <Description>
              {exact.length > 0
                ? `Already tracking ${exact.map((t) => `“${t.label}”`).join(", ")}`
                : entries.length > 1
                  ? `${entries.length} keywords ready to add`
                  : countries.length === 0
                    ? "Add a country above to localize keywords"
                    : "AI writes the local phrase for each country"}
            </Description>
          </TextField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            isDisabled={entries.length === 0 || countries.length === 0}
            isPending={adding === "localize"}
          >
            {localizeLabel}
          </Button>
          <Button
            variant="outline"
            isDisabled={entries.length === 0}
            isPending={adding === "english"}
            onPress={() => add(false)}
          >
            Add English Only
          </Button>
        </div>
      </form>

      {board.terms.length === 0 ? (
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>No Keywords Yet</EmptyState.Title>
            <EmptyState.Description>
              Type an English keyword above. Localize writes the local phrase
              for every country, or add it in English only.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <DataGrid
          aria-label="Keywords"
          data={rows}
          columns={columns}
          getRowId={rowId}
          getChildren={(row) =>
            row.kind === "country" ? undefined : row.children
          }
          expandedKeys={expandedKeys}
          onExpandedChange={setExpanded}
          sortDescriptor={sort}
          onSortChange={setSort}
          renderEmptyState={() => (
            <span className="text-sm text-muted">
              No keywords match. Add it with the buttons above.
            </span>
          )}
        />
      )}
    </div>
  );
}

const GROUP_LABELS: Record<Group, string> = {
  listing: "In Your Listing",
  ideas: "Ideas",
  hidden: "Hidden",
};

function KeywordCell({
  appId,
  row,
  isMine,
}: {
  appId: number;
  row: Row;
  isMine: boolean;
}) {
  if (row.kind === "group") {
    const label =
      row.group === "listing" && !isMine
        ? "In Listing"
        : GROUP_LABELS[row.group];
    return (
      <span className="whitespace-nowrap">
        <span className="font-medium">{label}</span>{" "}
        <span className="text-muted tabular-nums">{row.count}</span>
      </span>
    );
  }
  if (row.kind === "term") {
    return (
      <Link href={`/apps/${appId}/k/${row.term.id}`}>{row.term.label}</Link>
    );
  }

  const { flag, name } = getCountry(row.country);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="whitespace-nowrap">
        <span aria-hidden="true">{flag}</span>{" "}
        <span aria-hidden="true">{row.country.toUpperCase()}</span>
        <span className="sr-only">{name}</span>
      </span>
      {row.cell?.phrase ? (
        <span>{row.cell.phrase}</span>
      ) : (
        <span className="text-muted">{row.cell ? "Cleared" : "No phrase"}</span>
      )}
      {row.cell?.edited && row.cell.phrase !== null && (
        <Chip size="sm">Edited</Chip>
      )}
    </span>
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

function CountryRank({ cell }: { cell?: CellView }) {
  if (!cell?.phrase) return null;
  if (!cell.checked) {
    return cell.queued ? (
      <Spinner size="sm" color="current" aria-label="Checking" />
    ) : (
      <RankChip rank={null} />
    );
  }
  return <RankChip rank={cell.rank} />;
}

function EllipsisIcon() {
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable={false}
    >
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

/** Toast with Undo; the undo runs once and closes the toast. */
function toastWithUndo(
  message: string,
  undo: () => Promise<{ error?: string }>,
) {
  const id = toast(message, {
    actionProps: {
      children: "Undo",
      variant: "outline",
      onPress: async () => {
        toast.close(id);
        const res = await undo();
        if (res.error !== undefined) toast.danger(res.error);
      },
    },
  });
}

function TermActions({
  appId,
  term,
  total,
}: {
  appId: number;
  term: TermView;
  total: number;
}) {
  const [isPending, startTransition] = useTransition();
  const missing = total - term.countries;

  const run = (key: string) => {
    startTransition(async () => {
      if (key === "localize") {
        const res = await addTermsAction(appId, {
          labels: [term.label],
          localize: true,
        });
        if (res.error !== undefined) toast.danger(res.error);
        else toast.success(`Localized “${term.label}”`);
        return;
      }
      if (key === "hide" || key === "unhide") {
        const hidden = key === "hide";
        const res = await setHiddenAction(appId, [term.id], hidden);
        if (res.error !== undefined) {
          toast.danger(res.error);
          return;
        }
        toastWithUndo(
          hidden ? `Hid “${term.label}”` : `Unhid “${term.label}”`,
          () => setHiddenAction(appId, [term.id], !hidden),
        );
        return;
      }
      if (key === "delete") {
        const res = await deleteTermsAction(appId, [term.id]);
        if (res.error !== undefined) {
          toast.danger(res.error);
          return;
        }
        toastWithUndo(`Deleted “${term.label}”`, () =>
          restoreTermsAction(appId, [term.id]),
        );
      }
    });
  };

  return (
    <Dropdown>
      <Tooltip>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={`Actions for ${term.label}`}
          isPending={isPending}
        >
          <EllipsisIcon />
        </Button>
        <Tooltip.Content>Actions</Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={`Actions for ${term.label}`}
          onAction={(key) => run(String(key))}
        >
          {missing > 0 && total > 0 ? (
            <Dropdown.Item id="localize" textValue="Localize missing countries">
              <Label>Localize Missing Countries</Label>
              <Description>
                {missing} {missing === 1 ? "country" : "countries"} without a
                phrase
              </Description>
            </Dropdown.Item>
          ) : null}
          {term.hidden ? (
            <Dropdown.Item id="unhide" textValue="Unhide">
              <Label>Unhide</Label>
            </Dropdown.Item>
          ) : (
            <Dropdown.Item id="hide" textValue="Hide">
              <Label>Hide</Label>
              <Description>Keeps history, stops scheduled checks</Description>
            </Dropdown.Item>
          )}
          <Dropdown.Item id="delete" textValue="Delete" variant="danger">
            <Label>Delete</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function PhraseEditor({
  appId,
  term,
  country,
  cell,
}: {
  appId: number;
  term: TermView;
  country: string;
  cell?: CellView;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState(cell?.phrase ?? "");
  const [pending, setPending] = useState<"save" | "clear" | null>(null);
  const [, startTransition] = useTransition();
  const { name } = getCountry(country);

  const save = (phrase: string | null) => {
    setPending(phrase === null ? "clear" : "save");
    startTransition(async () => {
      const res = await setPhraseAction(appId, term.id, country, phrase);
      setPending(null);
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      setIsOpen(false);
    });
  };

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) setValue(cell?.phrase ?? "");
        setIsOpen(open);
      }}
    >
      <Button
        variant="ghost"
        aria-label={`Edit ${name} phrase for ${term.label}`}
      >
        Edit
      </Button>
      <Popover.Content placement="bottom end">
        <Popover.Dialog aria-label={`${name} phrase`}>
          <form
            className="flex w-72 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save(value);
            }}
          >
            <TextField
              fullWidth
              autoFocus
              variant="secondary"
              value={value}
              onChange={setValue}
            >
              <Label>{name} Phrase</Label>
              <Input placeholder={term.label} />
              <Description>
                Your phrase is kept; AI will not overwrite it.
              </Description>
            </TextField>
            <div className="flex justify-end gap-2">
              {cell?.phrase != null && (
                <Button
                  variant="danger-soft"
                  isPending={pending === "clear"}
                  onPress={() => save(null)}
                >
                  Clear
                </Button>
              )}
              <Button
                type="submit"
                isDisabled={normalize(value) === ""}
                isPending={pending === "save"}
              >
                Save
              </Button>
            </div>
          </form>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
