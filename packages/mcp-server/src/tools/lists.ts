import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ListFilter, ListName } from "@beli/client";
import { AppContext, guard, ok } from "../context.js";

const Category = z
  .enum(["RES", "BAR", "COFFEE", "BAKERY", "DESSERT", "OTHER"])
  .default("RES");

export function registerListTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_been",
    {
      title: "Get Been list",
      description:
        "List a user's ranked 'Been' places for a category. Omit userId for yourself.",
      inputSchema: { category: Category, userId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ category, userId }) => {
      await ctx.throttle();
      const res = await ctx.client.getBeen(category, userId);
      return ok(res.results);
    }),
  );

  server.registerTool(
    "get_want_to_try",
    {
      title: "Get Want-to-Try list",
      description:
        "List a user's 'Want to Try' bookmarks for a category. Omit userId for yourself.",
      inputSchema: { category: Category, userId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ category, userId }) => {
      await ctx.throttle();
      return ok(await ctx.client.getWantToTry(category, userId));
    }),
  );
}

/**
 * Search/filter tool over the personal lists.
 *
 * Filtering happens client-side over the rows `get-ranking` / `get-bookmark`
 * return; see the header of @beli/client's lists.ts for why, and for what would
 * change if Beli's own `filter-list` endpoint were ever pinned down. Each call
 * fetches one category's list, so it is one upstream request per invocation.
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
      const results = await ctx.client.searchList(
        list as ListName,
        category,
        filter,
        userId,
      );
      return ok({
        count: results.length,
        // Say plainly where the filtering happened, so a caller never mistakes
        // these for server-side filtered results.
        filteredBy: "client-side over get-ranking/get-bookmark",
        results,
      });
    }),
  );
}
