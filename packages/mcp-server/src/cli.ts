#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BeliClient, emptySession } from "@beli/client";
import { FileSessionStore } from "./auth.js";
import { loadConfig } from "./config.js";
import { runInteractiveLogin } from "./login/server.js";
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
 */
async function main(): Promise<void> {
  const cmd = process.argv[2];
  const config = loadConfig();

  if (cmd === "login") {
    if (config.password && (config.email || config.phone)) {
      const client = new BeliClient({
        email: config.email,
        phone: config.phone,
        password: config.password,
        store: new FileSessionStore(config.sessionPath),
      });
      await client.init();
      await client.login();
      process.stderr.write(
        `logged in as ${client.userId} (headless); session saved to ${config.sessionPath}\n`,
      );
      return;
    }
    const { userId } = await runInteractiveLogin(config);
    process.stderr.write(
      `logged in as ${userId}; session saved to ${config.sessionPath}\n`,
    );
    return;
  }

  if (cmd === "logout") {
    const store = new FileSessionStore(config.sessionPath);
    await store.save(emptySession());
    process.stderr.write(`session cleared at ${config.sessionPath}\n`);
    return;
  }

  if (cmd === "whoami") {
    const client = new BeliClient({ store: new FileSessionStore(config.sessionPath) });
    await client.init();
    if (!client.isAuthenticated()) {
      process.stderr.write("(not logged in)\n");
      return;
    }
    if (client.userId) {
      process.stderr.write(`${client.userId}\n`);
      return;
    }
    try {
      // No cached user id (session predates userId caching, or was cleared), so
      // re-derive it with a live refresh call.
      await client.ensureAuth();
      process.stderr.write(`${client.userId ?? "(unknown user id)"}\n`);
    } catch (err) {
      process.stderr.write(
        `session present but could not be refreshed: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return;
  }

  const { server } = await buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("beli-mcp-plus ready on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`beli-mcp fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
