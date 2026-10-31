import { getStartProgress } from "./start/data";
import { StartScreen } from "./start/start-screen";

export default function Home() {
  // Unawaited: the heading and steps stream in while the search is already usable
  return <StartScreen progress={getStartProgress()} />;
}
