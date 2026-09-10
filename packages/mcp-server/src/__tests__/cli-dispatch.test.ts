import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { HELP_TEXT, runCli } from "../cli-dispatch.js";

describe("runCli — argv dispatch", () => {
  let dir: string;
  let stdout: string[];
  let stderr: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-cli-test-"));
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const config = () => loadConfig({ BELI_HOME: dir, BELI_MIN_INTERVAL_MS: "0" });

  it("--help prints usage naming all four subcommands and the no-args default, and is handled (not start-server)", async () => {
    const outcome = await runCli(["--help"], config());
    expect(outcome).toBe("handled");
    const out = stdout.join("");
    for (const word of ["login", "logout", "whoami", "probe"]) {
      expect(out).toContain(word);
    }
    expect(out.toLowerCase()).toContain("no arguments");
    expect(out.toLowerCase()).toContain("stdio");
  });

  it("-h is an alias for --help", async () => {
    const outcome = await runCli(["-h"], config());
    expect(outcome).toBe("handled");
    expect(stdout.join("")).toBe(HELP_TEXT);
  });

  it("no args falls through to start-server (preserves prior default behavior)", async () => {
    expect(await runCli([], config())).toBe("start-server");
  });

  it("an unrecognized command falls through to start-server (preserves prior default behavior)", async () => {
    expect(await runCli(["not-a-real-command"], config())).toBe("start-server");
  });

  it("logout is handled and clears the session file", async () => {
    const outcome = await runCli(["logout"], config());
    expect(outcome).toBe("handled");
    expect(stderr.join("")).toMatch(/session cleared/);
  });

  it("probe (no network, no credentials): handled, prints a report to stdout, writes probe-report.json, never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const cfg = config();
    const outPath = join(dir, "probe-report.json");
    cfg.probeOutputPath = outPath;

    const outcome = await runCli(["probe"], cfg);
    expect(outcome).toBe("handled");

    const out = stdout.join("");
    expect(out).toContain("FINDINGS SUMMARY");
    expect(out).toContain("NOT authenticated");

    const written = JSON.parse(await readFile(outPath, "utf8")) as Record<string, unknown>;
    expect(written).toHaveProperty("hosts");
    expect(written).toHaveProperty("session");
    expect(written).toHaveProperty("categories");
    expect(written).toHaveProperty("listField");
    expect(written).toHaveProperty("facets");
    expect(written).toHaveProperty("recs");
  });
});
