import { Chip } from "@heroui/react";

export type NextStep = "keep" | "push" | "try" | "long-shot" | "skip";

const STEPS: Record<
  NextStep,
  { label: string; color: "success" | "accent" | "default" | "warning" }
> = {
  keep: { label: "Keep", color: "success" },
  push: { label: "Push", color: "accent" },
  try: { label: "Worth a try", color: "default" },
  "long-shot": { label: "Long shot", color: "warning" },
  skip: { label: "Skip", color: "default" },
};

type Props = { step: NextStep; size?: "sm" | "md" | "lg" };

export function NextStepChip({ step, size }: Props) {
  const { label, color } = STEPS[step];
  return (
    <Chip color={color} variant="soft" size={size}>
      {label}
    </Chip>
  );
}
