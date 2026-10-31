"use client";

import { Table } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getCountry } from "@/components/countries";

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
            <Table.Column>Volume</Table.Column>
            <Table.Column>Difficulty</Table.Column>
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
