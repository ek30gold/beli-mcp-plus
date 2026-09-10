#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCli } from "./cli-dispatch.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

/**
 * `beli-mcp`            -> start the stdio MCP server (uses the saved session).
 * `beli-mcp login`      -> open a localhost browser login, validate credentials
 *                          against Beli, and persist the session, then exit.
 *                          Logs in headless (no browser, useful for CI) when
 *                          credentials are already resolved — first match wins:
 *                          BELI_EMAIL or BELI_PHONE + BELI_PASSWORD env vars,
 *                          then $BELI_HOME/config.json (mode 0600 or it's
 *                          ignored). The browser form itself also accepts
 *                          either an email or a phone number.
 * `beli-mcp logout`     -> clear the saved session.
 * `beli-mcp whoami`     -> print the authenticated user id from the saved session
 *                          (only the refresh token is persisted, so this performs
 *                          a live token refresh to confirm/learn the user id).
 * `beli-mcp probe`      -> run read-only API diagnostics and print a report
 *                          (see cli-dispatch.ts / probe.ts).
 * `beli-mcp --help`     -> print usage and exit.
 *
 * The actual per-command logic lives in cli-dispatch.ts (kept import-safe /
 * side-effect-free at module scope so it's unit-testable); this file is just
 * the process entrypoint.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const outcome = await runCli(process.argv.slice(2), config);
  if (outcome === "start-server") {
    const { server } = await buildServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("beli-mcp-plus ready on stdio\n");
  }
}

main().catch((err) => {
  process.stderr.write(`beli-mcp fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
