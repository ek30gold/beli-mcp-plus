import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppContext, guard, ok } from "../context.js";
import { formatHumanReport, runProbe } from "../probe.js";

/**
 * `beli_doctor` — read-only diagnostics, sharing its implementation with the
 * `beli-mcp-plus probe` CLI command (see ../probe.ts). Resolves the category
 * enum and the (previously undocumented) `list_field` values for Been /
 * Want-to-Try / Recs against the caller's own account, and reports host
 * reachability + session state. Never mutates anything.
 */
export function registerDoctorTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "beli_doctor",
    {
      title: "Beli diagnostics",
      description:
        "Run read-only diagnostics against the Beli API: host reachability, session/auth " +
        "state, the accepted `category` values for get-ranking, the resolved `list_field` " +
        "value(s) for filter-list (Been / Want to Try / Recs), a facet-config summary, and " +
        "the recs endpoints' response shape. Safe to run at any time; makes no writes.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const report = await runProbe({ client: ctx.client, config: ctx.config, throttle: () => ctx.throttle() });
      return ok(formatHumanReport(report));
    }),
  );
}
