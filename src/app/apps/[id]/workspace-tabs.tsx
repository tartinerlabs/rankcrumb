"use client";

import { Tabs } from "@heroui/react";
import { useSelectedLayoutSegment } from "next/navigation";
import { isTab, TAB_LABELS, tabsFor } from "./tabs";

type Props = { trackId: number; isMine: boolean };

/** Tab links that keep the tab in the URL: /apps/<id>/<tab>. */
export function WorkspaceTabs({ trackId, isMine }: Props) {
  const segment = useSelectedLayoutSegment();
  const current = segment && isTab(segment) ? segment : "board";

  return (
    <Tabs selectedKey={current}>
      <Tabs.ListContainer>
        <Tabs.List aria-label="App workspace">
          {tabsFor(isMine).map((tab) => (
            <Tabs.Tab key={tab} id={tab} href={`/apps/${trackId}/${tab}`}>
              {TAB_LABELS[tab]}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}
