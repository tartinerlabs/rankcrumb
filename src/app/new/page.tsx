import type { Metadata } from "next";
import { Suspense } from "react";
import { getStartProgress } from "../start/data";
import { StartScreen } from "../start/start-screen";

export const metadata: Metadata = { title: "New" };

export default function NewPage({ searchParams }: PageProps<"/new">) {
  return (
    <Suspense fallback={null}>
      <WithMode searchParams={searchParams} />
    </Suspense>
  );
}

// ?mode=niche opens Brainstorm a Niche, e.g. from Test an App Idea
async function WithMode({
  searchParams,
}: {
  searchParams: PageProps<"/new">["searchParams"];
}) {
  const { mode } = await searchParams;
  const initialMode = mode === "niche" ? "niche" : "app";
  // Keyed so a link to the other mode resets the screen instead of keeping its state
  return (
    <StartScreen
      key={initialMode}
      progress={getStartProgress()}
      initialMode={initialMode}
    />
  );
}
