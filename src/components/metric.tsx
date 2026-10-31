type Props = {
  kind: "volume" | "difficulty";
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
