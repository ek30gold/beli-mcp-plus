import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ListFilter, ListName } from "@beli/client";
import { AppContext, guard, ok } from "../context.js";

const Category = z
  .enum(["RES", "BAR", "COFFEE", "BAKERY", "DESSERT", "OTHER"])
  .default("RES");

/**
 * `category` accepts any single category, or "all".
 *
 * "all" is the default because the single-category behaviour was a silent
 * correctness trap: both endpoints require a category, so a caller asking for
 * "my Been list" got one category's rows and no indication the rest existed.
 * On the probed account that meant 388 restaurants standing in for a 548-place
 * list, with nothing in the response hinting at the other 160.
 */
const CategoryOrAll = z.union([Category, z.literal("all")]);

/**
 * Attached to single-category responses so a partial list can never be
 * mistaken for a whole one, mirroring `AggregatedList.incompleteReason`.
 */
const SINGLE_CATEGORY_NOTE = {
  incompleteReason:
    "This is ONE category only. Beli splits these lists across Restaurants, " +
    "Bars, Bakeries, Coffee & Tea and Ice Cream & Dessert. Pass category:'all' " +
    "for every confirmed category.",
} as const;

export function registerListTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_been",
    {
      title: "Get Been list",
      description:
        "List a user's ranked 'Been' places for a category. Omit userId for yourself.",
      inputSchema: {
        category: CategoryOrAll.default("all"),
        userId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ category, userId }) => {
      await ctx.throttle();
      if (category === "all") return ok(await ctx.client.allBeen(userId));
      const res = await ctx.client.getBeen(category, userId);
      return ok({ category, entries: res.results, ...SINGLE_CATEGORY_NOTE });
    }),
  );

  server.registerTool(
    "get_want_to_try",
    {
      title: "Get Want-to-Try list",
      description:
        "List a user's 'Want to Try' bookmarks for a category. Omit userId for yourself.",
      inputSchema: {
        category: CategoryOrAll.default("all"),
        userId: z.string().uuid().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ category, userId }) => {
      await ctx.throttle();
      if (category === "all") return ok(await ctx.client.allWantToTry(userId));
      const buckets = await ctx.client.getWantToTry(category, userId);
      return ok({ category, buckets, ...SINGLE_CATEGORY_NOTE });
    }),
  );
}

/**
 * Search/filter tool over the personal lists.
 *
 * Which backend runs is controlled by `BELI_LIST_BACKEND` (see config.ts /
 * `ListBackend` in @beli/client) and defaults to filtering client-side over
 * the rows `get-ranking` / `get-bookmark` return — see the header of
 * @beli/client's lists.ts for why that is the default, and what the "server"
 * backend adds now that Beli's own `filter-list` endpoint has been pinned
 * down. Each call fetches at least one category's list, so it is at least one
 * upstream request per invocation.
 */
export function registerListSearchTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "search_list",
    {
      title: "Search a personal list",
      description:
        "Search and filter your Been or Want-to-Try list by name, city, " +
        "neighborhood, cuisine, price and (Been only) score. Omit userId for " +
        "yourself. Note: rows with no price are excluded when a price bound is " +
        "set, and rows with no score are excluded when a score bound is set, " +
        "so any score bound empties a Want-to-Try list.",
      inputSchema: {
        list: z.enum(["been", "want_to_try"]).describe("Which list to search."),
        category: Category,
        userId: z.string().uuid().optional(),
        query: z
          .string()
          .optional()
          .describe("Case-insensitive substring over name, cuisine, neighborhood and city."),
        city: z.string().optional(),
        neighborhood: z.string().optional(),
        cuisine: z.string().optional(),
        minPrice: z.number().int().min(1).max(4).optional(),
        maxPrice: z.number().int().min(1).max(4).optional(),
        minScore: z.number().min(0).max(10).optional().describe("Been only."),
        maxScore: z.number().min(0).max(10).optional().describe("Been only."),
        sort: z
          .enum(["score_desc", "score_asc", "name_asc", "name_desc"])
          .default("score_desc"),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ list, category, userId, ...rest }) => {
      await ctx.throttle();
      const filter: ListFilter = rest;
      const backend = ctx.config.listBackend;
      const results = await ctx.client.searchList(
        list as ListName,
        category,
        filter,
        userId,
        backend,
      );
      return ok({
        count: results.length,
        // Say plainly where the filtering happened, so a caller never mistakes
        // these for a backend other than the one that actually ran.
        filteredBy:
          backend === "server"
            ? "server-side membership via POST /api/filter-list/, filtered/sorted client-side"
            : "client-side over get-ranking/get-bookmark",
        results,
      });
    }),
  );
}
