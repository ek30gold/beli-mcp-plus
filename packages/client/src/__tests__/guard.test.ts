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

describe("BeliClient — uploadPhoto goes through the guard", () => {
  // uploadPhoto used to call fetch directly: no pacing, and the breaker never
  // saw a 429/user_inactive coming back from an upload. Every outbound call
  // must pass through the guard, writes included.
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const freshJwt = () => {
    const exp = Math.floor(Date.now() / 1000) + 1200;
    return `h.${b64u({ exp, user_id: "11111111-1111-1111-1111-111111111111" })}.s`;
  };
  const makeClient = async (guardOpts: ConstructorParameters<typeof RequestGuard>[0]) => {
    const store = new MemorySessionStore();
    const exp = Math.floor(Date.now() / 1000) + 1200;
    store.save({
      access: freshJwt(),
      refresh: null,
      userId: "11111111-1111-1111-1111-111111111111",
      accessExp: exp,
    });
    const client = new BeliClient({ store, guard: guardOpts });
    await client.init();
    return client;
  };

  const upload = (client: BeliClient) =>
    client.uploadPhoto({ businessId: 7316, image: new Uint8Array([1, 2, 3]) });

  it("paces uploads like any other request", async () => {
    // Asserted by observing the guard rather than by wall-clock elapsed time:
    // a real 200ms sleep makes the assertion a timing race on a loaded runner,
    // and every other test in this file drives pacing through an injected
    // clock for exactly that reason. Spying on beforeRequest proves the upload
    // is gated by the same mechanism without waiting on a timer to prove it.
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"id": 123}', { status: 201 })));
    const client = await makeClient({ minIntervalMs: 0 });
    const beforeRequest = vi.spyOn(client.guard, "beforeRequest");

    await upload(client);
    await upload(client);

    expect(beforeRequest).toHaveBeenCalledTimes(2);
    beforeRequest.mockRestore();
    vi.unstubAllGlobals();
  });

  it("actually waits between uploads, measured on an injected clock", async () => {
    // The companion to the test above: this one proves the pacing MATH, using
    // RequestGuard's injectable now/sleep so no real time passes.
    const guard = new RequestGuard({ minIntervalMs: 200 });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);

    await guard.beforeRequest(1_000, sleep);
    await guard.beforeRequest(1_000, sleep); // a second upload at the same instant

    expect(waits).toEqual([200]);
  });

  it("trips the breaker on a 429 from an upload, then fails locally", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("Too Many Requests", { status: 429 });
      }),
    );
    const client = await makeClient({ minIntervalMs: 0 });

    await expect(upload(client)).rejects.toThrow(/429/);
    expect(client.guard.isTripped).toBe(true);
    const afterFirst = calls;

    await expect(upload(client)).rejects.toBeInstanceOf(AccountLockoutError);
    expect(calls).toBe(afterFirst); // no further network traffic
    vi.unstubAllGlobals();
  });

  it("refuses to upload at all once the breaker has tripped", async () => {
    const fetchMock = vi.fn(async () => new Response('{"id": 1}', { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await makeClient({ minIntervalMs: 0 });
    client.guard.noteResponse(401, "user_inactive");

    await expect(upload(client)).rejects.toBeInstanceOf(AccountLockoutError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
