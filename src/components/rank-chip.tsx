import { Chip } from "@heroui/react";

type Props = {
  /** 1-based App Store rank; null or undefined when not ranked */
  rank: number | null | undefined;
  size?: "sm" | "md" | "lg";
};

/** Rank tier: success in the top 10, warning for 11-50, neutral beyond 50 or unranked. */
export function RankChip({ rank, size }: Props) {
  const ranked = rank != null && rank > 0;
  const color = !ranked
    ? "default"
    : rank <= 10
      ? "success"
      : rank <= 50
        ? "warning"
        : "default";
  return (
    <Chip color={color} variant="soft" size={size}>
      <Chip.Label>
        {ranked ? (
          <span className="tabular-nums">{rank}</span>
        ) : (
          <>
            <span aria-hidden="true">–</span>
            <span className="sr-only">Not ranked</span>
          </>
        )}
      </Chip.Label>
    </Chip>
  );
}
