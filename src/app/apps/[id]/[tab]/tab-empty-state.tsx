import { EmptyState } from "@heroui-pro/react";
import type { Tab } from "../tabs";

const COPY: Record<Tab, { title: string; description: string }> = {
  board: {
    title: "Your Keyword Board",
    description:
      "Each tracked keyword will sit here with its rank, volume and difficulty in every country.",
  },
  keywords: {
    title: "Your Keywords",
    description:
      "The full keyword list will live here, each with a next step: keep, push, worth a try, long shot or skip.",
  },
  track: {
    title: "Rank Tracking",
    description:
      "One card per country will show how many keywords are in the top 10 and how ranks moved.",
  },
  optimize: {
    title: "Optimize Your Listing",
    description:
      "Suggestions for your name, subtitle and keyword field will appear here, built from your best keywords.",
  },
};

export function TabEmptyState({ tab }: { tab: Tab }) {
  const { title, description } = COPY[tab];
  return (
    <EmptyState>
      <EmptyState.Header>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description>{description}</EmptyState.Description>
      </EmptyState.Header>
    </EmptyState>
  );
}
