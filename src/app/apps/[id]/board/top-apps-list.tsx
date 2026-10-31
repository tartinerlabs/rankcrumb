import { Avatar, Chip } from "@heroui/react";
import type { TopApp } from "@/db/schema";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type Props = {
  apps: TopApp[];
  /** The workspace app, marked where it appears */
  appId: number;
  isMine: boolean;
};

/** Ranked apps with icon, name and rating count; the workspace app is marked. */
export function TopAppsList({ apps, appId, isMine }: Props) {
  return (
    <ol className="flex flex-col gap-2">
      {apps.map((app, i) => (
        <li key={app.id} className="flex items-center gap-2">
          <span className="w-4 shrink-0 text-end text-xs text-muted tabular-nums">
            {i + 1}
          </span>
          <Avatar size="sm">
            <Avatar.Image src={app.icon} alt="" />
            <Avatar.Fallback>{app.name.slice(0, 1)}</Avatar.Fallback>
          </Avatar>
          <span
            className={`min-w-0 flex-1 truncate text-sm ${app.id === appId ? "font-medium" : ""}`}
          >
            {app.name}
          </span>
          {app.id === appId && (
            <Chip color="accent" variant="soft" size="sm">
              {isMine ? "You" : "This App"}
            </Chip>
          )}
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {compact.format(app.ratings ?? 0)}
            <span className="sr-only"> ratings</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
