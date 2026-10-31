import { buttonVariants } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react";
import Link from "next/link";
import { countryWeights } from "@/lib/terms";
import { BoardGrid } from "./board-grid";
import { loadBoardView } from "./data";

type Props = {
  appId: number;
  isMine: boolean;
  /** Storefront codes from the country bar, in display order */
  countries: string[];
};

// Columns come from the saved storefronts, busiest first; the country bar can show tracked ones before any are saved
export async function BoardTab({ appId, isMine }: Props) {
  const [view, weighted] = await Promise.all([
    loadBoardView(appId, { withTopApps: true }),
    countryWeights(appId),
  ]);
  const board = {
    ...view,
    countries: weighted.filter((c) => view.countries.includes(c)),
  };
  if (board.countries.length === 0) {
    return (
      <BoardEmpty
        title="Add a Country"
        description="Pick the App Store countries to research with Add Country above. Each one becomes a column here."
      />
    );
  }
  if (board.terms.every((t) => t.hidden)) {
    return (
      <BoardEmpty
        title="No Keywords Yet"
        description="Add keywords in English and each one appears here with its rank, difficulty and volume in every country."
        action={{ href: `/apps/${appId}/keywords`, label: "Add Keywords" }}
      />
    );
  }
  return <BoardGrid appId={appId} isMine={isMine} board={board} />;
}

function BoardEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Header>
      {action && (
        <EmptyState.Content>
          <Link href={action.href} className={buttonVariants()}>
            {action.label}
          </Link>
        </EmptyState.Content>
      )}
    </EmptyState>
  );
}
