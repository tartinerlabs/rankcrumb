import type { Metadata } from "next";
import { CheckForm } from "./check-form";

export const metadata: Metadata = { title: "Check" };

export const maxDuration = 120;

export default function CheckPage() {
  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-lg font-semibold tracking-tight">Keyword Check</h1>
      <p className="mt-1 mb-6 text-muted-foreground">
        Volume, difficulty and your app&apos;s placement for each keyword and
        storefront, from live App Store search results.
      </p>
      <CheckForm />
    </div>
  );
}
