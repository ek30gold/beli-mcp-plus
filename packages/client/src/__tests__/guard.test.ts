import { describe, expect, it, vi } from "vitest";
import {
  AccountLockoutError,
  BeliClient,
  LoginBudgetError,
  MemorySessionStore,
  RequestGuard,
} from "@beli/client";

/** A guard with no real waiting, so pacing logic is testable instantly. */
const nowait = () => Promise.resolve();

describe("RequestGuard — pacing", () => {
  it("paces consecutive requests by the minimum interval", async () => {
    const g = new RequestGuard({ minIntervalMs: 350 });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);

    await g.beforeRequest(1000, sleep);
    await g.beforeRequest(1000, sleep); // same instant: must be made to wait
    expect(waits).toEqual([350]);
  });

  it("does not delay a request that is already late enough", async () => {
    const g = new RequestGuard({ minIntervalMs: 350 });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);

    await g.beforeRequest(1000, sleep);
    await g.beforeRequest(5000, sleep);
    expect(waits).toEqual([]);
  });
});

describe("RequestGuard — login budget", () => {
  it("allows logins up to the budget, then refuses", async () => {
    const g = new RequestGuard({ maxLoginsPerWindow: 3, loginWindowMs: 600_000 });
    await g.beforeLogin(0, nowait);
    await g.beforeLogin(1000, nowait);
    await g.beforeLogin(2000, nowait);
    await expect(g.beforeLogin(3000, nowait)).rejects.toBeInstanceOf(LoginBudgetError);
  });

  it("frees the budget once the window rolls past", async () => {
    const g = new RequestGuard({ maxLoginsPerWindow: 1, loginWindowMs: 10_000 });
    await g.beforeLogin(0, nowait);
    await expect(g.beforeLogin(5000, nowait)).rejects.toBeInstanceOf(LoginBudgetError);
    await g.beforeLogin(20_000, nowait); // window has rolled: allowed again
  });

  it("explains why, so the error is actionable rather than cryptic", async () => {
    const g = new RequestGuard({ maxLoginsPerWindow: 1 });
    await g.beforeLogin(0, nowait);
    await expect(g.beforeLogin(1, nowait)).rejects.toThrow(/refresh token/i);
  });
});

describe("RequestGuard — lockout breaker", () => {
  it.each([
    [401, '{"detail":"User is inactive","code":"user_inactive"}'],
    [401, '{"detail":"No active account found with the given credentials"}'],
    [429, "Too Many Requests"],
  ])("trips on %i %s", async (status, body) => {
    const g = new RequestGuard();
    g.noteResponse(status, body);
    expect(g.isTripped).toBe(true);
    await expect(g.beforeRequest(0, nowait)).rejects.toBeInstanceOf(AccountLockoutError);
  });

  it("does NOT trip on ordinary errors that are part of normal use", async () => {
    const g = new RequestGuard();
    // The live API really does answer 500 for some category codes, and 404s
    // are routine. Tripping on these would make the client unusable.
    g.noteResponse(500, '{"detail":"Internal Server Error"}');
    g.noteResponse(404, '{"detail":"Not found"}');
    g.noteResponse(400, '{"detail":"Invalid category BAKERY"}');
    expect(g.isTripped).toBe(false);
    await g.beforeRequest(0, nowait);
  });

  it("blocks logins too, not just ordinary requests", async () => {
    const g = new RequestGuard();
    g.noteResponse(401, "user_inactive");
    await expect(g.beforeLogin(0, nowait)).rejects.toBeInstanceOf(AccountLockoutError);
  });

  it("stays tripped until explicitly reset — never self-heals", async () => {
    const g = new RequestGuard();
    g.noteResponse(401, "user_inactive");
    g.noteResponse(200, "ok"); // a later success must not silently clear it
    expect(g.isTripped).toBe(true);
    g.resetGuard();
    expect(g.isTripped).toBe(false);
    await g.beforeRequest(0, nowait);
  });
});

describe("BeliClient — the incident, reproduced", () => {
  it("stops after the first 'User is inactive' instead of hammering on", async () => {
    // This is the sequence that deactivated a real account: a 401 saying the
    // user is inactive, which the client answered by re-authenticating and
    // retrying, over and over. It must now stop dead at the first signal.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response('{"detail":"User is inactive","code":"user_inactive"}', {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const client = new BeliClient({
      email: "tester@example.com",
      password: "irrelevant",
      store: new MemorySessionStore(),
      guard: { minIntervalMs: 0 },
    });

    await expect(client.login({ email: "tester@example.com", password: "x" })).rejects.toThrow();
    const afterFirst = calls;

    // Every subsequent attempt must fail locally, adding no traffic at all.
    for (let i = 0; i < 5; i += 1) {
      await expect(client.ensureAuth()).rejects.toBeInstanceOf(AccountLockoutError);
    }
    expect(calls).toBe(afterFirst);

    vi.unstubAllGlobals();
  });

  it("refuses a burst of fresh logins the way the debug scripts did", async () => {
    // Four throwaway scripts each constructed a client with a fresh in-memory
    // store and logged in again. With a shared guard that is now refused.
    const guard = new RequestGuard({ maxLoginsPerWindow: 3, minIntervalMs: 0 });
    await guard.beforeLogin(0, nowait);
    await guard.beforeLogin(100, nowait);
    await guard.beforeLogin(200, nowait);
    await expect(guard.beforeLogin(300, nowait)).rejects.toBeInstanceOf(LoginBudgetError);
  });
});
