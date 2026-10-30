"use client";

import {
  Button,
  IconPlus,
  ListBox,
  Popover,
  ScrollShadow,
  SearchField,
  Tag,
  TagGroup,
  toast,
} from "@heroui/react";
import { useState, useTransition } from "react";
import { Autocomplete, useFilter } from "react-aria-components/Autocomplete";
import { setCountriesAction } from "@/actions/terms";
import { COUNTRIES, getCountry } from "@/components/countries";

type Props = { trackId: number; countries: string[] };

/** The app's countries as removable flag tags, plus an Add country picker. */
export function CountryBar({ trackId, countries }: Props) {
  const [isPending, startTransition] = useTransition();

  const save = (next: string[]) => {
    startTransition(async () => {
      const res = await setCountriesAction(trackId, next);
      if (res.error !== undefined) toast.danger(res.error);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {countries.length > 0 && (
        <TagGroup
          aria-label="Countries"
          onRemove={(keys) => save(countries.filter((c) => !keys.has(c)))}
        >
          <TagGroup.List>
            {countries.map((code) => {
              const { flag, name } = getCountry(code);
              return (
                <Tag key={code} id={code} textValue={name}>
                  <span aria-hidden="true">{flag}</span> {name}
                  <Tag.RemoveButton aria-label={`Remove ${name}`} />
                </Tag>
              );
            })}
          </TagGroup.List>
        </TagGroup>
      )}
      <AddCountry
        existing={countries}
        isPending={isPending}
        onAdd={(code) => save([...countries, code])}
      />
    </div>
  );
}

function AddCountry({
  existing,
  isPending,
  onAdd,
}: {
  existing: string[];
  isPending: boolean;
  onAdd: (code: string) => void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button size="sm" variant="ghost" isPending={isPending}>
        <IconPlus />
        Add country
      </Button>
      <Popover.Content placement="bottom start">
        <Popover.Dialog aria-label="Add country">
          <div className="flex w-72 flex-col gap-3">
            <Autocomplete filter={contains}>
              <SearchField
                aria-label="Search countries"
                autoFocus
                variant="secondary"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search countries" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ScrollShadow className="max-h-64 overflow-y-auto">
                <ListBox
                  aria-label="Countries"
                  items={COUNTRIES}
                  disabledKeys={existing}
                  onAction={(key) => {
                    setIsOpen(false);
                    onAdd(String(key));
                  }}
                >
                  {(country) => (
                    <ListBox.Item id={country.code} textValue={country.name}>
                      <span aria-hidden="true">{country.flag}</span>{" "}
                      {country.name}
                    </ListBox.Item>
                  )}
                </ListBox>
              </ScrollShadow>
            </Autocomplete>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
