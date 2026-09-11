import { describe, expect, it, vi, afterEach } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";
import { makeFakeBeli, type FakeBeliOptions } from "./fake-beli.js";

/**
 * Token-lifecycle coverage.
 *
 * A live probe run confirmed the happy path (a stored refresh token yields an
 * access token with no re-login: `refreshTokenValid: true, loginAttempted:
 * false` in probe-report.json). What live running does NOT exercise is what
 * happens when the refresh token itself is rejected — the case that will
 * eventually happen in production, silently, hours into a session. These
 * tests pin the fallback chain: refresh -> credentials -> interactive hook ->
 * a clear error.
 */

const BASE: FakeBeliOptions = { beenIds: [1], wantToTryIds: [2], filterList: {} };

function fake(extra: Partial<FakeBeliOptions> = {}) {
  const f = makeFakeBeli({ ...BASE, ...extra });
  vi.stubGlobal("fetch", vi.fn(f.fetch));
  return f;
}

/** A client that already has a stored refresh token, as a returning run does. */
function clientWithRefresh(opts: { credentials?: boolean; onAuthRequired?: () => Promise<void> } = {}) {
  const store = new MemorySessionStore();
  store.save({ refresh: "stored-refresh-token", userId: "902c99ec-31bb-4c2b-bb65-2bd8c6848b91" });
  return new BeliClient({
    ...(opts.credentials === false ? {} : { email: "tester@example.com", password: "irrelevant" }),
    store,
    onAuthRequired: opts.onAuthRequired,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("token lifecycle", () => {
  it("uses the stored refresh token without re-logging in", async () => {
    const f = fake();
    const client = clientWithRefresh();
    await client.init();
    await client.ensureAuth();

    expect(f.authCalls.refresh).toBe(1);
    expect(f.authCalls.login).toBe(0);
  });

  it("falls back to credentials when the refresh token is rejected", async () => {
    const f = fake({ rejectRefresh: true });
    const client = clientWithRefresh();
    await client.init();
    await client.ensureAuth();

    // The refresh is attempted first, then credentials carry the session.
    expect(f.authCalls.refresh).toBeGreaterThanOrEqual(1);
    expect(f.authCalls.login).toBeGreaterThanOrEqual(1);
  });

  it("invokes the interactive hook when refresh fails and there are no credentials", async () => {
    fake({ rejectRefresh: true });
    const onAuthRequired = vi.fn(async () => {});
    const client = clientWithRefresh({ credentials: false, onAuthRequired });
    await client.init();

    await expect(client.ensureAuth()).rejects.toThrow();
    expect(onAuthRequired).toHaveBeenCalled();
  });

  it("throws an actionable error, not a raw 401, when every path is exhausted", async () => {
    fake({ rejectRefresh: true, rejectLogin: true });
    const client = clientWithRefresh();
    await client.init();

    // The message must tell an operator what to actually do.
    await expect(client.ensureAuth()).rejects.toThrow(/login/i);
  });

  it("single-flights concurrent refreshes into one token call", async () => {
    const f = fake();
    const client = clientWithRefresh();
    await client.init();

    await Promise.all([
      client.ensureAuth(),
      client.ensureAuth(),
      client.ensureAuth(),
      client.ensureAuth(),
    ]);

    // Four concurrent callers must not stampede the token endpoint.
    expect(f.authCalls.refresh).toBe(1);
  });

  it("reuses a still-fresh access token instead of refreshing again", async () => {
    const f = fake();
    const client = clientWithRefresh();
    await client.init();
    await client.ensureAuth();
    await client.ensureAuth();

    expect(f.authCalls.refresh).toBe(1);
  });
});
