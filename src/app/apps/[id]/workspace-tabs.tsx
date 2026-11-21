"use client";

import { Tabs, Typography } from "@heroui/react";
import { useSelectedLayoutSegment } from "next/navigation";
import { isTab, TAB_LABELS, tabHelp, tabsFor } from "./tabs";

type Props = { trackId: number; isMine: boolean };

/** Tab links that keep the tab in the URL: /apps/<id>/<tab>. */
export function WorkspaceTabs({ trackId, isMine }: Props) {
  const segment = useSelectedLayoutSegment();
  const current = segment && isTab(segment) ? segment : "board";

  // Sub-pages such as a keyword's history have their own heading
  const onTab = segment === null || isTab(segment);

  return (
    <div className="flex flex-col gap-3">
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
      {onTab && (
        <Typography.Paragraph size="sm" color="muted">
          {tabHelp(current, isMine)}
        </Typography.Paragraph>
      )}
    </div>
  );
}
