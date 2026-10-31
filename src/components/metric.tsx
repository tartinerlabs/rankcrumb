"use client";

import { Tooltip } from "@heroui/react";
import { InfoIcon } from "@/components/icons";

type Kind = "volume" | "difficulty";

// ASD-STE100 wording; the code still says volume/difficulty
export const METRIC_HELP: Record<Kind, string> = {
  volume:
    "This number (0 to 100) shows how many top apps use this keyword in their name. Apple does not give search data. A high number usually shows that people search for this keyword. A high number is good.",
  difficulty:
    "This number (0 to 100) shows how difficult it is to get a higher rank than the top 10 apps. The calculation uses mostly the number of ratings that these apps have. A low number is good.",
};

const METRIC_NAME: Record<Kind, string> = {
  volume: "Demand",
  difficulty: "Competition",
};

/** Metric name with an info tooltip; label overrides the name (e.g. "Avg Demand"). */
export function MetricLabel({ kind, label }: { kind: Kind; label?: string }) {
  const name = label ?? METRIC_NAME[kind];
  return (
    <span className="inline-flex items-center gap-1">
      {name}
      <Tooltip>
        {/* Stop the press reaching a sortable column header */}
        <Tooltip.Trigger
          aria-label={`About ${name}`}
          className="text-muted"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <InfoIcon width={14} height={14} />
        </Tooltip.Trigger>
        <Tooltip.Content className="max-w-xs">
          {METRIC_HELP[kind]}
        </Tooltip.Content>
      </Tooltip>
    </span>
  );
}

type Props = {
  kind: Kind;
  /** 0-100; null when not checked yet */
  value: number | null | undefined;
};

// Colour always sits on the number itself: high volume is good, high difficulty is bad
const HIGH_VOLUME = 50;
const HIGH_DIFFICULTY = 70;

export function Metric({ kind, value }: Props) {
  if (value == null) {
    return (
      <span className="tabular-nums text-muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not checked</span>
      </span>
    );
  }
  const tone =
    kind === "volume"
      ? value >= HIGH_VOLUME
        ? "text-success"
        : "text-foreground"
      : value >= HIGH_DIFFICULTY
        ? "text-danger"
        : "text-foreground";
  return <span className={`tabular-nums ${tone}`}>{value}</span>;
}
