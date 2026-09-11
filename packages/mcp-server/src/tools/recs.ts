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
 * array), but individual item fields are not, so items are passed through
 * exactly as the API returned them rather than reshaped or narrowed. See
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
        "CONFIRMED live: the response is a top-level array of items. The " +
        "shape of an individual item was NOT confirmed by the live probe, " +
        "so items are returned exactly as the API sent them — treat their " +
        "fields as unverified rather than assuming names like " +
        "'business_id' or 'score'.",
      inputSchema: { userId: z.string().uuid().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ userId }) => {
      await ctx.throttle();
      const res = await ctx.client.getRecs(userId);
      // Confirmed envelope is a bare array; a {results:[...]} wrapper is
      // accepted too (see RecsResponse) but never actually observed.
      const items = Array.isArray(res) ? res : res.results;
      return ok({
        count: items.length,
        itemShapeConfirmed: false,
        items,
      });
    }),
  );
}
