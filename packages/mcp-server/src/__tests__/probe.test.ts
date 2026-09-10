import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";
import { loadConfig } from "../config.js";
import { extractListFieldHints, formatHumanReport, redact, runProbe } from "../probe.js";

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const fakeAccessToken = (userId: string) =>
  `h.${b64u({ exp: Math.floor(Date.now() / 1000) + 1200, user_id: userId })}.s`;

function baseEnv(dir: string): NodeJS.ProcessEnv {
  return { BELI_HOME: dir, BELI_MIN_INTERVAL_MS: "0" };
}

describe("redact", () => {
  it("returns a placeholder for null/undefined", () => {
    expect(redact(null)).toBe("(none)");
    expect(redact(undefined)).toBe("(none)");
  });

  it("truncates long tokens to a short prefix and never returns the full value", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.some.very-long-secret-token-value-that-must-not-leak";
    const out = redact(token);
    expect(out.startsWith("eyJhbGciOi")).toBe(true);
    expect(out).not.toBe(token);
    expect(out.length).toBeLessThan(token.length);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns short values unchanged (nothing to redact)", () => {
    expect(redact("short")).toBe("short");
  });
});

describe("extractListFieldHints", () => {
  it("finds candidates from a list-selector-shaped facet config", () => {
    const hints = extractListFieldHints({
      facets: [{ key: "LIST_FIELD", options: ["TRENDING", "BEEN", "WANT_TO_TRY"] }],
    });
    expect(hints).toEqual(expect.arrayContaining(["TRENDING", "BEEN", "WANT_TO_TRY"]));
  });

  it("returns no hints for unrelated/unknown shapes without throwing", () => {
    expect(extractListFieldHints({ unrelated: { deeply: { nested: "value" } } })).toEqual([]);
    expect(extractListFieldHints(null)).toEqual([]);
    expect(extractListFieldHints(undefined)).toEqual([]);
    expect(extractListFieldHints("just a string")).toEqual([]);
    expect(extractListFieldHints(42)).toEqual([]);
  });
});

describe("runProbe", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-probe-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("no network, no credentials: never throws, reports hosts unreachable and a clear not-authenticated state, skips everything downstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const config = loadConfig(baseEnv(dir));
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();

    const report = await runProbe({ client, config });

    expect(report.hosts).toHaveLength(4);
    for (const h of report.hosts) {
      expect(h.reachable).toBe(false);
      expect(h.error).toBeTruthy();
    }

    expect(report.session.authenticated).toBe(false);
    expect(report.session.userId).toBeNull();
    expect(report.session.refreshTokenPresent).toBe(false);
    expect(report.session.credentialsAvailable).toBe(false);

    expect(report.categories.skipped).toBe(true);
    expect(report.listField.skipped).toBe(true);
    expect(report.facets.skipped).toBe(true);
    expect(report.recs.skipped).toBe(true);

    // Must be JSON-serializable (the CLI writes this straight to probe-report.json).
    expect(() => JSON.stringify(report)).not.toThrow();

    const human = formatHumanReport(report);
    expect(human).toContain("FINDINGS SUMMARY");
    expect(human).toContain("NOT authenticated");
    expect(human.indexOf("FINDINGS SUMMARY")).toBeLessThan(human.indexOf("1. HOST REACHABILITY"));
  });

  it("wrong password: produces a clean auth-failure report, not an exception, and never leaks the password", async () => {
    const SECRET = "definitely-wrong-hunter2!";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/token/") && init?.method === "POST") {
          return new Response(JSON.stringify({ detail: "No active account found with the given credentials" }), {
            status: 401,
          });
        }
        // host-reachability GETs against the bare hosts
        return new Response("not found", { status: 404 });
      }),
    );

    const config = loadConfig({
      ...baseEnv(dir),
      BELI_EMAIL: "someone@example.com",
      BELI_PASSWORD: SECRET,
    });
    const client = new BeliClient({
      email: config.email,
      phone: config.phone,
      password: config.password,
      store: new MemorySessionStore(),
    });
    await client.init();

    const report = await runProbe({ client, config });

    expect(report.session.credentialsAvailable).toBe(true);
    expect(report.session.loginAttempted).toBe(true);
    expect(report.session.loginSucceeded).toBe(false);
    expect(report.session.loginError).toBeTruthy();
    expect(report.session.authenticated).toBe(false);
    expect(report.categories.skipped).toBe(true);

    const human = formatHumanReport(report);
    const asJson = JSON.stringify(report);
    expect(human).not.toContain(SECRET);
    expect(asJson).not.toContain(SECRET);
    expect(human.toLowerCase()).not.toContain(SECRET.toLowerCase());
  });

  it("redacts the access token: preview is a short prefix, full token never appears in the report", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const fullToken = fakeAccessToken(userId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/token/") && init?.method === "POST") {
          return new Response(JSON.stringify({ access: fullToken, refresh: "r1" }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const config = loadConfig({
      ...baseEnv(dir),
      BELI_EMAIL: "someone@example.com",
      BELI_PASSWORD: "correct-password",
    });
    const client = new BeliClient({
      email: config.email,
      phone: config.phone,
      password: config.password,
      store: new MemorySessionStore(),
    });
    await client.init();

    const report = await runProbe({ client, config });

    expect(report.session.loginSucceeded).toBe(true);
    expect(report.session.userId).toBe(userId);
    expect(report.session.accessTokenPreview).not.toBe(fullToken);
    expect(report.session.accessTokenPreview.endsWith("…")).toBe(true);
    expect(fullToken.startsWith(report.session.accessTokenPreview.replace("…", ""))).toBe(true);

    const human = formatHumanReport(report);
    const asJson = JSON.stringify(report);
    expect(human).not.toContain(fullToken);
    expect(asJson).not.toContain(fullToken);
    expect(human).toContain(report.session.accessTokenPreview);
  });
});
