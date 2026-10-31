import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { CACHE_TAGS } from "@/actions/act";
import {
  addApp,
  addCompetitor,
  getApp,
  listApps,
  removeCompetitor,
  searchApps,
  suggestCompetitors,
  updateApp,
} from "@/lib/apps";
import {
  createBrainstorm,
  deleteBrainstorm,
  getBrainstorm,
  listBrainstorms,
} from "@/lib/brainstorms";
import { UserError } from "@/lib/checks";
import { gateState, QueuePausedError, ThrottledError } from "@/lib/gate";
import { InvalidStorefrontError } from "@/lib/itunes";
import { importCandidates, proposeListing } from "@/lib/listing";
import { checkNow, getProgress } from "@/lib/queue";
import {
  addTerms,
  deleteTerms,
  loadBoard,
  loadHistory,
  loadTrack,
  localizeMissing,
  restoreTerms,
  setCountries,
  setHidden,
  setPhrase,
  trackPhrases,
} from "@/lib/terms";

// set_countries, add_keywords and propose_listing wait on AI calls of up to 45s each
export const maxDuration = 300;

const json = (data: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  isError,
});

/** Run a tool body: user-facing failures become an error result, anything else is thrown. Expires the cached reads afterwards. */
async function run(fn: () => Promise<unknown>) {
  try {
    return json((await fn()) ?? { ok: true });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, true);
    if (e instanceof InvalidStorefrontError) {
      return json({ error: "Unknown App Store storefront" }, true);
    }
    if (e instanceof ThrottledError) {
      const until =
        e instanceof QueuePausedError
          ? e.until
          : (await gateState()).pausedUntil;
      return json(
        {
          error:
            until && until.getTime() > Date.now()
              ? `App Store is rate limiting searches. Try again after ${until.toISOString().slice(11, 16)} UTC.`
              : "App Store is rate limiting searches. Try again in a minute.",
        },
        true,
      );
    }
    throw e;
  } finally {
    // Via after(): legacy clients get a streamed response, which flushes tag expiries before the tool ends
    after(() => {
      for (const tag of CACHE_TAGS) revalidateTag(tag, { expire: 0 });
    });
  }
}

const appId = z.number().int().positive().describe("Numeric App Store ID");
const termIds = z
  .array(z.number().int().positive())
  .min(1)
  .describe("Keyword (term) ids from app_board");
const storefront = z
  .string()
  .describe("Two-letter storefront code, e.g. us, de, jp");
const readOnly = { readOnlyHint: true };

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_apps",
      {
        title: "List apps",
        description:
          "Apps added to the workspace, yours first: storefronts, schedule, keyword count and competitors.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      () => run(() => listApps()),
    );

    server.registerTool(
      "get_app",
      {
        title: "Get app",
        description: "One workspace app with its storefronts and competitors.",
        inputSchema: z.object({ appId }),
        annotations: readOnly,
      },
      ({ appId }) => run(() => getApp(appId)),
    );

    server.registerTool(
      "search_apps",
      {
        title: "Search apps",
        description:
          "Find App Store apps by name, App Store link or numeric ID. Hits show whether each app is already saved.",
        inputSchema: z.object({
          query: z.string().describe("App name, App Store link or numeric ID"),
        }),
        annotations: readOnly,
      },
      ({ query }) => run(() => searchApps(query)),
    );

    server.registerTool(
      "add_app",
      {
        title: "Add app",
        description:
          "Add an app to the workspace, as one of yours or as a researched app. Your apps with no storefronts return needsCountries; then call set_countries.",
        inputSchema: z.object({
          appId,
          storefront: storefront.default("us"),
          mine: z.boolean().describe("True if it is one of your apps"),
        }),
      },
      ({ appId, storefront, mine }) =>
        run(() => addApp({ id: appId, country: storefront, mine })),
    );

    server.registerTool(
      "update_app",
      {
        title: "Update app",
        description:
          "Change an app's check schedule, main listing language (App Store Connect locale) or whether it is yours.",
        inputSchema: z.object({
          appId,
          schedule: z.enum(["off", "daily", "weekly"]).optional(),
          language: z
            .string()
            .optional()
            .describe("App Store Connect locale, e.g. en-US"),
          mine: z.boolean().optional(),
        }),
      },
      ({ appId, ...patch }) => run(() => updateApp(appId, patch)),
    );

    server.registerTool(
      "set_countries",
      {
        title: "Set storefronts",
        description:
          "Replace the storefronts researched for an app, in display order. Keywords are translated into new storefronts and queued for checking.",
        inputSchema: z.object({
          appId,
          storefronts: z
            .array(z.string())
            .min(1)
            .describe("Two-letter storefront codes, at most 40"),
        }),
      },
      ({ appId, storefronts }) => run(() => setCountries(appId, storefronts)),
    );

    server.registerTool(
      "localize_missing",
      {
        title: "Retry translation",
        description:
          "Fill any storefront phrase still missing for an app's keywords (all, or the given ones), e.g. after a failed translation.",
        inputSchema: z.object({ appId, termIds: termIds.optional() }),
      },
      ({ appId, termIds }) => run(() => localizeMissing(appId, termIds)),
    );

    server.registerTool(
      "app_board",
      {
        title: "Keyword board",
        description:
          "Every keyword of an app with its phrase per storefront and the latest volume, difficulty and placement. Placement null means not in the first 200 results.",
        inputSchema: z.object({ appId }),
        annotations: readOnly,
      },
      ({ appId }) => run(() => loadBoard(appId)),
    );

    server.registerTool(
      "country_track",
      {
        title: "Storefront rankings",
        description:
          "An app's placement per keyword in one storefront, with the change since the previous check, a suggested next step and the apps it most often ranks below.",
        inputSchema: z.object({ appId, storefront }),
        annotations: readOnly,
      },
      ({ appId, storefront }) => run(() => loadTrack(appId, storefront)),
    );

    server.registerTool(
      "keyword_history",
      {
        title: "Keyword history",
        description:
          "Placement, volume and difficulty over time for one keyword of an app, per storefront.",
        inputSchema: z.object({
          appId,
          termId: z
            .number()
            .int()
            .positive()
            .describe("Term id from app_board"),
        }),
        annotations: readOnly,
      },
      ({ appId, termId }) => run(() => loadHistory(appId, termId)),
    );

    server.registerTool(
      "add_keywords",
      {
        title: "Add keywords",
        description:
          "Add English keywords to an app. With localize, each is translated into the app's other storefronts; without it, only English storefronts get it. New phrases are queued for checking.",
        inputSchema: z.object({
          appId,
          keywords: z
            .array(z.string())
            .min(1)
            .describe("English keywords, at most 100"),
          localize: z.boolean().default(true),
        }),
      },
      ({ appId, keywords, localize }) =>
        run(() => addTerms(appId, { labels: keywords, localize })),
    );

    server.registerTool(
      "track_phrases",
      {
        title: "Track phrases",
        description:
          "Track brainstorm phrases (keyword ids from get_brainstorm) for an app. English phrases become keywords, translated when localize is set; other phrases stay in their storefront only.",
        inputSchema: z.object({
          appId,
          keywordIds: z.array(z.number().int().positive()).min(1),
          localize: z.boolean().default(true),
        }),
      },
      ({ appId, keywordIds, localize }) =>
        run(() => trackPhrases(appId, { keywordIds, localize })),
    );

    server.registerTool(
      "set_phrase",
      {
        title: "Set phrase",
        description:
          "Set the phrase a keyword uses in one storefront, or null to stop tracking it there. Translation never overwrites it.",
        inputSchema: z.object({
          appId,
          termId: z
            .number()
            .int()
            .positive()
            .describe("Term id from app_board"),
          storefront,
          phrase: z.string().nullable(),
        }),
      },
      ({ appId, termId, storefront, phrase }) =>
        run(() => setPhrase(appId, termId, storefront, phrase)),
    );

    server.registerTool(
      "hide_keywords",
      {
        title: "Hide keywords",
        description:
          "Hide keywords (or show them again with hidden false). Hidden keywords keep their history but are not checked on schedule.",
        inputSchema: z.object({
          appId,
          termIds,
          hidden: z.boolean().default(true),
        }),
      },
      ({ appId, termIds, hidden }) =>
        run(() => setHidden(appId, termIds, hidden)),
    );

    server.registerTool(
      "delete_keywords",
      {
        title: "Delete keywords",
        description:
          "Delete keywords from an app. restore_keywords brings them back within a day.",
        inputSchema: z.object({ appId, termIds }),
      },
      ({ appId, termIds }) => run(() => deleteTerms(appId, termIds)),
    );

    server.registerTool(
      "restore_keywords",
      {
        title: "Restore keywords",
        description: "Undo delete_keywords within a day of deleting.",
        inputSchema: z.object({ appId, termIds }),
      },
      ({ appId, termIds }) => run(() => restoreTerms(appId, termIds)),
    );

    server.registerTool(
      "check_now",
      {
        title: "Check now",
        description:
          "Queue an app's visible keywords (or the given ones) for checking unless checked in the last hour. Returns how many were queued; follow with check_progress.",
        inputSchema: z.object({ appId, termIds: termIds.optional() }),
      },
      ({ appId, termIds }) =>
        run(async () => ({ queued: await checkNow(appId, termIds) })),
    );

    server.registerTool(
      "check_progress",
      {
        title: "Check progress",
        description:
          "Pending and finished checks for an app or a brainstorm, the worker state and an estimate in seconds. Pass appId or brainstormId.",
        inputSchema: z.object({
          appId: appId.optional(),
          brainstormId: z.number().int().positive().optional(),
        }),
        annotations: readOnly,
      },
      ({ appId, brainstormId }) =>
        run(() =>
          getProgress(
            appId !== undefined
              ? { appId }
              : { brainstormId: brainstormId as number },
          ),
        ),
    );

    server.registerTool(
      "suggest_competitors",
      {
        title: "Suggest competitors",
        description:
          "Apps that most often appear in the top 10 for an app's keywords, with how many keywords each covers.",
        inputSchema: z.object({
          appId,
          limit: z.number().int().positive().optional(),
        }),
        annotations: readOnly,
      },
      ({ appId, limit }) => run(() => suggestCompetitors(appId, limit)),
    );

    server.registerTool(
      "add_competitor",
      {
        title: "Add competitor",
        description: "Mark an app as a competitor of a workspace app.",
        inputSchema: z.object({
          appId,
          competitorId: z
            .number()
            .int()
            .positive()
            .describe("Numeric App Store ID of the competitor"),
          storefront: storefront.optional(),
        }),
      },
      ({ appId, competitorId, storefront }) =>
        run(() =>
          addCompetitor(appId, { id: competitorId, country: storefront }),
        ),
    );

    server.registerTool(
      "remove_competitor",
      {
        title: "Remove competitor",
        description: "Stop treating an app as a competitor of a workspace app.",
        inputSchema: z.object({
          appId,
          competitorId: z.number().int().positive(),
        }),
      },
      ({ appId, competitorId }) =>
        run(() => removeCompetitor(appId, competitorId)),
    );

    server.registerTool(
      "brainstorm",
      {
        title: "Brainstorm keywords",
        description:
          "Save an app idea and get 15 to 25 AI keyword phrases for it, in each storefront's language. Phrases are queued for checking; read them with get_brainstorm.",
        inputSchema: z.object({
          idea: z.string().describe("The app idea, 20 to 4000 characters"),
          storefronts: z
            .array(z.string())
            .min(1)
            .optional()
            .describe("Two-letter storefront codes, at most 5 (default us)"),
        }),
      },
      ({ idea, storefronts }) =>
        run(() => createBrainstorm({ idea, countries: storefronts })),
    );

    server.registerTool(
      "list_brainstorms",
      {
        title: "List brainstorms",
        description: "Saved app ideas, newest first.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      () => run(() => listBrainstorms()),
    );

    server.registerTool(
      "get_brainstorm",
      {
        title: "Get brainstorm",
        description:
          "A saved idea's phrases with the latest volume, difficulty and top apps of each.",
        inputSchema: z.object({ id: z.number().int().positive() }),
        annotations: readOnly,
      },
      ({ id }) => run(() => getBrainstorm(id)),
    );

    server.registerTool(
      "delete_brainstorm",
      {
        title: "Delete brainstorm",
        description:
          "Delete a saved idea. Its phrases and their checks are kept.",
        inputSchema: z.object({ id: z.number().int().positive() }),
      },
      ({ id }) => run(() => deleteBrainstorm(id)),
    );

    server.registerTool(
      "import_candidates",
      {
        title: "Listing keyword candidates",
        description:
          "Keywords found in an app's listing (keyword field, name and subtitle) that are not tracked yet. Add them with add_keywords.",
        inputSchema: z.object({ appId }),
        annotations: readOnly,
      },
      ({ appId }) => run(() => importCandidates(appId)),
    );

    server.registerTool(
      "propose_listing",
      {
        title: "Propose listing",
        description:
          "AI options for the name, subtitle and keyword field of one of your apps in up to 5 storefronts, scored by the volume of tracked keywords they cover. Saves nothing.",
        inputSchema: z.object({
          appId,
          storefronts: z
            .array(z.string())
            .min(1)
            .describe("Two-letter storefront codes, at most 5"),
        }),
        annotations: readOnly,
      },
      ({ appId, storefronts }) => run(() => proposeListing(appId, storefronts)),
    );
  },
  { serverInfo: { name: "rankcrumb", version: "0.2.0" } },
);

/** Accept only the MCP_TOKEN bearer; reject everything when it is unset. */
function verifyToken(_req: Request, bearerToken?: string) {
  const expected = process.env.MCP_TOKEN;
  if (!expected || !bearerToken) return undefined;
  const a = Buffer.from(bearerToken);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return { token: bearerToken, clientId: "owner", scopes: [] };
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
