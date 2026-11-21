import { Skeleton } from "@heroui/react";
import { Suspense } from "react";
import { getHomeStep, getStartProgress } from "./start/data";
import { Home } from "./start/home";
import { StartScreen } from "./start/start-screen";

// First visit: add an app or test an idea. After that: the one next step.
export default function HomePage() {
  return (
    <Suspense fallback={<LandingFallback />}>
      <Landing />
    </Suspense>
  );
}

async function Landing() {
  const progress = await getStartProgress();
  if (!progress.hasApps) {
    return <StartScreen progress={Promise.resolve(progress)} />;
  }
  return <Home step={await getHomeStep()} />;
}

function LandingFallback() {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-8 sm:px-6 sm:pt-16"
      aria-hidden="true"
    >
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
