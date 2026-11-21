import {
  Accordion,
  buttonVariants,
  Card,
  Chip,
  Typography,
} from "@heroui/react";
import Link from "next/link";
import { getCountry } from "@/components/countries";
import { NextStepChip } from "@/components/next-step-chip";
import type { HomeStep, HomeWord } from "./data";

/** Home for people who already added an app: one next step, then how the app works. */
export function Home({ step }: { step: HomeStep }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pt-8 pb-12 sm:px-6 sm:pt-16">
      <section className="flex flex-col gap-4" aria-labelledby="next-heading">
        <Typography.Heading level={1} id="next-heading">
          What to Do Next
        </Typography.Heading>
        <NextStepCard step={step} />
      </section>
      <Guide />
      <div className="flex flex-wrap gap-3">
        <Link href="/new" className={buttonVariants({ variant: "outline" })}>
          Add Another App
        </Link>
        <Link
          href="/new?mode=niche"
          className={buttonVariants({ variant: "ghost" })}
        >
          Test an App Idea
        </Link>
      </div>
    </div>
  );
}

type Copy = {
  title: string;
  body: string;
  words?: HomeWord[];
  /** Shown under the button: what happens after the user acts */
  after?: string;
  action: { href: string; label: string };
};

// Store names run long ("Trace: Location Timeline"); sentences use the part before the tagline
const shortName = (name: string) => name.split(/\s*[:–—|]\s|\s-\s/)[0] || name;

// Country names that read "in the United States"
const WITH_THE = new Set(["us", "gb", "ae", "nl", "ph", "cz", "do", "bs"]);
const inCountry = (code: string) =>
  `in ${WITH_THE.has(code.toLowerCase()) ? "the " : ""}${getCountry(code).name}`;

function copyFor(step: HomeStep): Copy {
  if (step.kind === "add-app") {
    return {
      title: "Add Your Own App",
      body: "RankCrumb needs to know which app is yours. Search for it on the App Store, then choose My App.",
      action: { href: "/new", label: "Add Your App" },
    };
  }
  const app = { ...step.app, name: shortName(step.app.name) };
  const base = `/apps/${app.trackId}`;
  switch (step.kind) {
    case "countries":
      return {
        title: `Choose Where to Check ${app.name}`,
        body: "Pick the App Store countries where you sell. Search results are different in each country, so RankCrumb checks each one.",
        action: { href: `${base}/board`, label: "Pick Countries" },
      };
    case "keywords":
      return {
        title: `Add Search Words for ${app.name}`,
        body: `Think of words people type in the App Store to find an app like yours, for example "habit tracker". RankCrumb then checks where ${app.name} shows up for each word.`,
        action: { href: `${base}/keywords`, label: "Add Search Words" },
      };
    case "waiting":
      return {
        title: `RankCrumb Is Checking ${app.name}`,
        body: "It searches the App Store for each of your words and notes where your app shows up. This takes a few minutes.",
        after: "Come back soon. Your next step will be here.",
        action: { href: `${base}/board`, label: `Open ${app.name}` },
      };
    case "try":
      return {
        title: `Put These Words in ${app.name}'s Listing`,
        body: `Many people ${inCountry(step.country)} search for these words, and ${app.name} does not show up for them yet. The App Store only shows your app for words in its name, subtitle or keyword field.`,
        words: step.words,
        after: `After you publish the new listing on the App Store, RankCrumb checks again every few hours. Come back in a few days to see if ${app.name} shows up.`,
        action: { href: `${base}/optimize`, label: "Write a New Listing" },
      };
    case "push":
      return {
        title: `Move ${app.name} Up for These Words`,
        body: `${app.name} shows up for these words ${inCountry(step.country)}, but below the top 10. Most people only look at the top 10. Putting the words in the name or subtitle can move you up.`,
        words: step.words,
        after:
          "After you publish the new listing, come back in a few days to see if your rank went up.",
        action: { href: `${base}/optimize`, label: "Write a New Listing" },
      };
    case "done":
      return {
        title: `${app.name} Is Doing Well`,
        body: `${app.name} is in the top 10 for ${step.top10} of its words ${inCountry(step.country)}, and no other word needs work now. To grow, add new words to check.`,
        action: { href: `${base}/keywords`, label: "Add More Words" },
      };
  }
}

function NextStepCard({ step }: { step: HomeStep }) {
  const { title, body, words, after, action } = copyFor(step);
  return (
    <Card>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        <Card.Description>{body}</Card.Description>
      </Card.Header>
      {words && (
        <Card.Content>
          <ul className="flex flex-col gap-2">
            {words.map((w) => (
              <li
                key={w.termId}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span className="font-medium">{w.phrase}</span>
                <span className="text-sm text-muted tabular-nums">
                  Demand {w.volume}
                  {w.difficulty !== null && ` · Competition ${w.difficulty}`}
                  {w.rank !== null && ` · Rank ${w.rank}`}
                </span>
              </li>
            ))}
          </ul>
        </Card.Content>
      )}
      <Card.Footer className="flex flex-col items-start gap-3">
        <Link href={action.href} className={buttonVariants()}>
          {action.label}
        </Link>
        {after && (
          <Typography.Paragraph size="sm" color="muted">
            {after}
          </Typography.Paragraph>
        )}
      </Card.Footer>
    </Card>
  );
}

function Guide() {
  return (
    <Accordion defaultExpandedKeys={["guide"]}>
      <Accordion.Item id="guide">
        <Accordion.Heading>
          <Accordion.Trigger>
            New Here? How RankCrumb Works
            <Accordion.Indicator />
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body>
            <div className="flex flex-col gap-6">
              <ol className="flex flex-col gap-3">
                <GuideStep n={1} title="Find words people search for">
                  People find apps by typing words in the App Store search.
                  RankCrumb shows which words many people type.
                </GuideStep>
                <GuideStep n={2} title="Put them in your listing">
                  The App Store only shows your app for words in its name,
                  subtitle or keyword field. The Listing tab helps you write
                  these.
                </GuideStep>
                <GuideStep n={3} title="Check where you show up">
                  Every few hours RankCrumb searches the App Store for your
                  words and notes your position. The top 10 is where people
                  look.
                </GuideStep>
              </ol>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
                <dt className="font-medium">Demand</dt>
                <dd className="text-muted">
                  0 to 100. How many people search for a word. Higher is better.
                </dd>
                <dt className="font-medium">Competition</dt>
                <dd className="text-muted">
                  0 to 100. How strong the top 10 apps for a word are. Lower is
                  better.
                </dd>
                <dt className="font-medium">Rank</dt>
                <dd className="text-muted">
                  Where your app shows up in search results. 1 is first.
                </dd>
                <dt className="font-medium">Next Step</dt>
                <dd className="flex flex-col gap-2 text-muted">
                  <span>RankCrumb's advice for each word:</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <NextStepChip step="keep" size="sm" />
                    <NextStepChip step="push" size="sm" />
                    <NextStepChip step="try" size="sm" />
                    <NextStepChip step="long-shot" size="sm" />
                    <NextStepChip step="skip" size="sm" />
                  </span>
                  <span>Point at a label to see what it means.</span>
                </dd>
              </dl>
            </div>
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function GuideStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="shrink-0">
        <Chip size="sm" variant="soft">
          <span className="tabular-nums">{n}</span>
        </Chip>
      </span>
      <div className="flex flex-col gap-1">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted">{children}</span>
      </div>
    </li>
  );
}
