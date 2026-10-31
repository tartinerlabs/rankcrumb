"use client";

import { Avatar, Button, Card, toast } from "@heroui/react";
import { EmptyState } from "@heroui-pro/react";
import { useTransition } from "react";
import { addCompetitorAction } from "@/actions/apps";
import { getCountry } from "@/components/countries";
import type { CountryTrack } from "./track-view";

type Props = {
  appId: number;
  country: string;
  losingTo: CountryTrack["losingTo"];
};

const compact = new Intl.NumberFormat("en", { notation: "compact" });

/** Apps ahead of this one in a country, most keywords ahead first. */
export function LosingToCards({ appId, country, losingTo }: Props) {
  if (losingTo.length === 0) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No One Is Consistently Ahead</EmptyState.Title>
          <EmptyState.Description>
            No app ranks above you on most keywords in{" "}
            {getCountry(country).name}.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {losingTo.map((l) => (
        <LosingToCard key={l.app.id} appId={appId} country={country} {...l} />
      ))}
    </div>
  );
}

function LosingToCard({
  appId,
  country,
  app,
  above,
  of,
  ratings,
  competitor,
}: Omit<Props, "losingTo"> & Props["losingTo"][number]) {
  const [isPending, startTransition] = useTransition();

  const track = () => {
    startTransition(async () => {
      const res = await addCompetitorAction(appId, { id: app.id, country });
      if (res.error !== undefined) toast.danger(res.error);
      else toast.success(`Tracking ${app.name} as a competitor`);
    });
  };

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center gap-3">
          <Avatar>
            <Avatar.Image src={app.icon} alt="" />
            <Avatar.Fallback>{app.name.slice(0, 1)}</Avatar.Fallback>
          </Avatar>
          <div className="min-w-0">
            <Card.Title>
              <span className="block truncate">{app.name}</span>
            </Card.Title>
            {ratings !== null && (
              <Card.Description>
                <span className="tabular-nums">{compact.format(ratings)}</span>{" "}
                {ratings === 1 ? "rating" : "ratings"}
              </Card.Description>
            )}
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        <p>
          Ahead on <span className="tabular-nums">{above}</span> of{" "}
          <span className="tabular-nums">{of}</span>{" "}
          {of === 1 ? "keyword" : "keywords"}
        </p>
      </Card.Content>
      <Card.Footer>
        <Button
          variant="outline"
          isDisabled={competitor}
          isPending={isPending}
          onPress={track}
        >
          {competitor ? "Tracked as Competitor" : "Track as Competitor"}
        </Button>
      </Card.Footer>
    </Card>
  );
}
