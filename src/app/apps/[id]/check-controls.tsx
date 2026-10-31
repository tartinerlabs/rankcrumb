"use client";

import { Button, Label, ProgressBar, toast } from "@heroui/react";
import { useEffect, useState, useTransition } from "react";
import {
  checkNowAction,
  pauseChecksAction,
  refreshChecksAction,
} from "@/actions/queue";

type Progress = {
  pending: number;
  done: number;
  total: number;
  state: "idle" | "running" | "paused" | "stalled";
};

const POLL_MS = 3000;

type Props = { trackId: number; checkedText: string | null };

/** Check now, then "Checking X of Y" with a progress bar and Pause while the queue works. */
export function CheckControls({ trackId, checkedText }: Props) {
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [poll, setPoll] = useState(0);
  const isActive = progress !== null && progress.pending > 0;

  // Read progress on open and after each Check now; keep polling while checks run
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasActive = false;
    const read = async () => {
      try {
        const res = await fetch(`/api/progress?appId=${trackId}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as Progress;
        if (cancelled) return;
        setProgress(next);
        if (next.pending > 0) {
          wasActive = true;
          timer = setTimeout(read, POLL_MS);
        } else if (wasActive) {
          // Run finished: expire the cached "Checked … ago" and sidebar, then refresh
          void refreshChecksAction();
        }
      } catch {
        // Offline or server restart; the next Check now reads again
      }
    };
    // poll changes after each Check now, restarting the read loop
    void poll;
    read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trackId, poll]);

  const checkNow = () => {
    startTransition(async () => {
      const res = await checkNowAction(trackId);
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      if (res.data === 0) {
        toast("Everything was checked in the last hour");
        return;
      }
      setPoll((n) => n + 1);
    });
  };

  // The check already running finishes; Check now afterwards resumes
  const pause = () => {
    startTransition(async () => {
      const res = await pauseChecksAction(trackId);
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      toast(`Paused ${res.data} ${res.data === 1 ? "check" : "checks"}`);
      setPoll((n) => n + 1);
    });
  };

  return (
    <div className="flex items-center gap-3">
      {isActive ? (
        <div className="w-44">
          <ProgressBar
            value={progress.done}
            maxValue={Math.max(progress.total, 1)}
            valueLabel={`${progress.done} of ${progress.total}`}
          >
            <Label>Checking</Label>
            <ProgressBar.Output>
              <span className="tabular-nums">
                {progress.done} of {progress.total}
              </span>
            </ProgressBar.Output>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </div>
      ) : (
        checkedText && (
          <span className="text-sm text-muted tabular-nums">{checkedText}</span>
        )
      )}
      {isActive ? (
        <Button variant="outline" isPending={isPending} onPress={pause}>
          Pause
        </Button>
      ) : (
        <Button variant="outline" isPending={isPending} onPress={checkNow}>
          Check now
        </Button>
      )}
    </div>
  );
}
