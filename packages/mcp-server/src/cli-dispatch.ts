import { writeFile } from "node:fs/promises";
import { BeliClient, emptySession } from "@beli/client";
import { FileSessionStore } from "./auth.js";
import type { Config } from "./config.js";
import { runInteractiveLogin } from "./login/server.js";
import { renderDiscovered } from "./discovered-gen.js";
import { formatHumanReport, runProbe } from "./probe.js";

export const HELP_TEXT = `beli-mcp-plus — MCP server + CLI for Beli (beliapp.com)

Usage:
  beli-mcp-plus                 Start the MCP server on stdio (default; used by MCP clients).
  beli-mcp-plus login           Log in to Beli (browser, or headless if credentials are
                                 configured) and save the session.
  beli-mcp-plus logout          Clear the saved local session.
  beli-mcp-plus whoami          Print the authenticated account id from the saved session.
  beli-mcp-plus probe           Run read-only diagnostics against the Beli API and print a
                                 report (host reachability, auth/session state, the accepted
                                 get-ranking category values, the resolved filter-list
                                 list_field value(s), a facet-config summary, and the recs
                                 endpoints' response shape). Also writes a machine-readable
                                 probe-report.json (see BELI_PROBE_OUTPUT below). Read-only —
                                 never mutates your account.
  beli-mcp-plus probe --emit-discovered[=PATH]
                                As above, and also generate the typed constants file
                                 (packages/contract/src/discovered.ts by default) from the
                                 live findings. Values the probe could not establish are
                                 emitted as null/UNRESOLVED, never as a guess.
  beli-mcp-plus --help, -h      Show this help and exit.

Running with no arguments starts the MCP server on stdio.

Environment:
  BELI_EMAIL / BELI_PHONE + BELI_PASSWORD   headless credentials (env wins over the config file)
  BELI_HOME                                 config/session directory (default: ~/.beli)
  BELI_NO_BROWSER=1                         disable interactive browser login
  BELI_ALLOW_WRITES=1                       allow write tools without per-call confirm:true
  BELI_PROBE_OUTPUT                         where \`probe\` writes probe-report.json
  BELI_DISCOVERED_OUTPUT                    where \`--emit-discovered\` writes discovered.ts
`;

/** What the caller (cli.ts) should do after `runCli` returns. */
export type CliOutcome = "start-server" | "handled";

/**
 * Pure-ish argv dispatcher shared by the real CLI entrypoint and its tests.
 * Every branch writes its own output and returns "handled"; anything not
 * recognized here (including no args at all) returns "start-server" so
 * cli.ts falls through to booting the stdio MCP server — this preserves the
 * pre-existing "anything else silently starts the server" behavior.
 */
export async function runCli(argv: string[], config: Config): Promise<CliOutcome> {
  const cmd = argv[0];

  if (cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP_TEXT);
    return "handled";
  }

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
      return "handled";
    }
    const { userId } = await runInteractiveLogin(config);
    process.stderr.write(`logged in as ${userId}; session saved to ${config.sessionPath}\n`);
    return "handled";
  }

  if (cmd === "logout") {
    const store = new FileSessionStore(config.sessionPath);
    await store.save(emptySession());
    process.stderr.write(`session cleared at ${config.sessionPath}\n`);
    return "handled";
  }

  if (cmd === "whoami") {
    const client = new BeliClient({ store: new FileSessionStore(config.sessionPath) });
    await client.init();
    if (!client.isAuthenticated()) {
      process.stderr.write("(not logged in)\n");
      return "handled";
    }
    if (client.userId) {
      process.stderr.write(`${client.userId}\n`);
      return "handled";
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
    return "handled";
  }

  if (cmd === "probe") {
    // No interactive-login hook: probe reports auth state rather than
    // launching a browser popup, so headless/CI runs behave predictably.
    const client = new BeliClient({
      email: config.email,
      phone: config.phone,
      password: config.password,
      store: new FileSessionStore(config.sessionPath),
    });
    await client.init();
    const report = await runProbe({ client, config });
    process.stdout.write(formatHumanReport(report) + "\n");
    try {
      await writeFile(config.probeOutputPath, JSON.stringify(report, null, 2), "utf8");
      process.stderr.write(`\nmachine-readable report written to ${config.probeOutputPath}\n`);
    } catch (err) {
      process.stderr.write(
        `warning: failed to write ${config.probeOutputPath}: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    // Optional codegen: turn the live findings into the typed contract file,
    // so nobody hand-transcribes overlap evidence into a confidence marker.
    const emitFlag = argv.find((a) => a === "--emit-discovered" || a.startsWith("--emit-discovered="));
    if (emitFlag) {
      const explicit = emitFlag.includes("=") ? emitFlag.split("=").slice(1).join("=") : "";
      const target = explicit || config.discoveredOutputPath;
      try {
        await writeFile(target, renderDiscovered(report), "utf8");
        process.stderr.write(`discovered constants written to ${target}\n`);
        if (!report.session.authenticated) {
          process.stderr.write(
            "warning: the probe was NOT authenticated, so every value in that file " +
              "is UNRESOLVED. Fix access and re-run before relying on it.\n",
          );
        }
      } catch (err) {
        process.stderr.write(
          `warning: failed to write ${target}: ` +
            `${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    return "handled";
  }

  return "start-server";
}
