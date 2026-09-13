import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppContext, guard, ok } from "../context.js";

/**
 * Recommendations tool.
 *
 * Scoped to GET {RECS}/api/recs/{uuid}/ only. `/api/rec-score/` is
 * deliberately not exposed here: the live probe got a 405 from it and its
 * shape is UNDETERMINED (`RECS_SHAPE.recScore === "not-run"` in
 * `@beli/contract`'s discovered.ts) — there is no confirmed response to
 * build a tool around.
 *
 * The `/api/recs/` response's envelope IS confirmed live (a top-level
 * array), and the item shape is confirmed too: every one of the probed
 * account's 24,392 items carried `business_id` and `expected_percentile`,
 * both numbers. Items are still passed through exactly as the API returned
 * them - `RecItem` keeps `.passthrough()`, so unmodeled fields survive. See
 * `RecItem`/`RecsResponse` in `@beli/contract`'s recs schema for the full
 * evidence note.
 */
export function registerRecsTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "get_recs",
    {
      title: "Get recommendations",
      description:
        "Fetch a user's personalized recommendations from the Beli recs " +
        "service (GET /api/recs/{uuid}/). Omit userId for yourself. " +
        "CONFIRMED live: the response is a top-level array of items, and " +
        "every item carries business_id and expected_percentile (both " +
        "numbers, verified on all 24,392 items of the probed account). " +
        "Unmodeled fields pass through untouched. The list is large (tens " +
        "of thousands of items on a real account), so results are paged - " +
        "use offset/limit to walk it rather than expecting one call to " +
        "return everything.",
      inputSchema: {
        userId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ userId, limit, offset }) => {
      await ctx.throttle();
      const res = await ctx.client.getRecs(userId);
      // Confirmed envelope is a bare array; a {results:[...]} wrapper is
      // accepted too (see RecsResponse) but never actually observed. Item
      // shape is confirmed as well (business_id / expected_percentile).
      const items = Array.isArray(res) ? res : res.results;
      // The endpoint has no server-side paging parameter we have confirmed,
      // so it always returns the full list (24,392 items on the probed
      // account). Page locally rather than returning all of it: an
      // unbounded dump would swamp the caller's context.
      // Defaults are declared on the input schema, but don't rely on the
      // caller having applied them — fall back explicitly.
      const off = offset ?? 0;
      const lim = limit ?? 50;
      const page = items.slice(off, off + lim);
      return ok({
        total: items.length,
        offset: off,
        limit: lim,
        returned: page.length,
        hasMore: off + page.length < items.length,
        itemShapeConfirmed: true,
        itemShape: { business_id: "number", expected_percentile: "number" },
        items: page,
      });
    }),
  );
}
