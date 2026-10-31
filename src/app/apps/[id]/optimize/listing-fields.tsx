"use client";

import {
  Chip,
  Description,
  FieldError,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import type { ListingText } from "@/db/schema";
import {
  coverageByField,
  KEYWORDS_MAX,
  keywordFieldError,
  NAME_MAX,
  type Phrase,
  SUBTITLE_MAX,
} from "./score";

type Props = {
  listing: ListingText;
  phrases: Phrase[];
  onChange: (listing: ListingText) => void;
  /** Rows of chips under each field listing the tracked phrases it covers */
  showCoverage?: boolean;
};

const FIELDS = [
  { key: "name", label: "Name", max: NAME_MAX },
  { key: "subtitle", label: "Subtitle", max: SUBTITLE_MAX },
  { key: "keywords", label: "Keyword Field", max: KEYWORDS_MAX },
] as const;

/** Name, subtitle and keyword field with Apple's limits and live coverage. */
export function ListingFields({
  listing,
  phrases,
  onChange,
  showCoverage = false,
}: Props) {
  const coverage = coverageByField(listing, phrases);
  const keywordError = keywordFieldError(listing);

  return (
    <div className="flex flex-col gap-4">
      {FIELDS.map(({ key, label, max }) => {
        const error = key === "keywords" ? keywordError : undefined;
        return (
          <div key={key} className="flex flex-col gap-2">
            <TextField
              fullWidth
              maxLength={max}
              value={listing[key]}
              isInvalid={error !== undefined}
              isRequired={key === "name"}
              onChange={(value) => onChange({ ...listing, [key]: value })}
            >
              <Label>{label}</Label>
              <Input />
              <Description>
                <span className="tabular-nums">
                  {listing[key].length}/{max}
                </span>
                {key === "keywords" && " · Single words, separated by commas"}
              </Description>
              <FieldError>{error}</FieldError>
            </TextField>
            {showCoverage && (
              <div className="flex flex-wrap gap-1">
                {coverage[key].length === 0 ? (
                  <span className="text-sm text-muted">
                    Covers no tracked keywords
                  </span>
                ) : (
                  coverage[key].map((p) => (
                    <Chip key={p.phrase} size="sm" variant="soft">
                      {p.phrase}
                    </Chip>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
