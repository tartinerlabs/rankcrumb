import { Chip } from "@heroui/react";
import { getCountry } from "./countries";

type Props = { code: string; size?: "sm" | "md" | "lg" };

/** Flag and country name, e.g. "🇺🇸 United States". */
export function CountryChip({ code, size }: Props) {
  const { flag, name } = getCountry(code);
  return (
    <Chip size={size}>
      <Chip.Label>
        <span aria-hidden="true">{flag}</span> {name}
      </Chip.Label>
    </Chip>
  );
}
