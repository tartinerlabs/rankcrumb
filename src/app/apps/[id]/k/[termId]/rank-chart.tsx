"use client";

import { LineChart } from "@heroui-pro/react/line-chart";

/** One row per check day (UTC midnight), with each storefront's rank under its code; missing when unranked or unchecked. */
export type RankRow = Record<string, number> & { t: number };

const COLORS = 5;

// Dates read in UTC like the rest of the app's messages
const day = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const checkedOn = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** One line per storefront: rank over time, #1 at the top, gaps where unranked. */
export function RankChart({
  rows,
  series,
  labelledBy,
  describedBy,
}: {
  rows: RankRow[];
  series: { country: string; name: string }[];
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <LineChart
      data={rows}
      role="figure"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <LineChart.Grid vertical={false} />
      <LineChart.XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={["dataMin", "dataMax"]}
        tickFormatter={(t: number) => day.format(t)}
      />
      <LineChart.YAxis
        reversed
        allowDecimals={false}
        domain={[1, "dataMax"]}
        tickFormatter={(r: number) => `#${r}`}
      />
      <LineChart.Tooltip
        content={
          <LineChart.TooltipContent
            labelFormatter={(t) => checkedOn.format(Number(t))}
            valueFormatter={(r) => `#${r}`}
          />
        }
      />
      {series.map((s, i) => (
        <LineChart.Line
          key={s.country}
          dataKey={s.country}
          name={s.name}
          stroke={`var(--chart-${(i % COLORS) + 1})`}
        />
      ))}
    </LineChart>
  );
}
