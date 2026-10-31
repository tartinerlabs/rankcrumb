import { loadBoardView } from "../board/data";
import { KeywordsManager } from "./keywords-manager";

type Props = {
  appId: number;
  isMine: boolean;
  /** Storefront codes from the country bar, in display order */
  countries: string[];
};

// Phrases follow the saved storefronts, which loadBoard reads itself
export async function KeywordsTab({ appId, isMine }: Props) {
  const board = await loadBoardView(appId);
  return <KeywordsManager appId={appId} isMine={isMine} board={board} />;
}
