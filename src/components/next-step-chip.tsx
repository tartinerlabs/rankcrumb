"use client";

import { Chip, Tooltip } from "@heroui/react";

export type NextStep = "keep" | "push" | "try" | "long-shot" | "skip";

// Accent stays for actions; each step gets its own tone or variant
const STEPS: Record<
  NextStep,
  {
    label: string;
    color: "success" | "default" | "warning" | "danger";
    variant: "soft" | "tertiary";
    help: string;
  }
> = {
  keep: {
    label: "Keep",
    color: "success",
    variant: "soft",
    help: "You rank in the top 10. Keep this keyword in your listing.",
  },
  push: {
    label: "Push",
    color: "warning",
    variant: "soft",
    help: "You rank 11 to 50 and Demand is 30 or more. Use this keyword more in your listing to move up.",
  },
  try: {
    label: "Worth a try",
    color: "default",
    variant: "soft",
    help: "You do not rank yet, Demand is 30 or more and Competition is below 70. Add this keyword to your listing.",
  },
  "long-shot": {
    label: "Long shot",
    color: "danger",
    variant: "soft",
    help: "Demand is 30 or more, but Competition is 70 or more. It is difficult to rank here.",
  },
  skip: {
    label: "Skip",
    color: "default",
    variant: "tertiary",
    help: "Demand is below 10. Few people search for this keyword.",
  },
};

type Props = { step: NextStep; size?: "sm" | "md" | "lg" };

export function NextStepChip({ step, size }: Props) {
  const { label, color, variant, help } = STEPS[step];
  return (
    <Tooltip>
      <Tooltip.Trigger aria-label={`${label}: ${help}`}>
        <Chip color={color} variant={variant} size={size}>
          <span className="whitespace-nowrap">{label}</span>
        </Chip>
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-xs">{help}</Tooltip.Content>
    </Tooltip>
  );
}
