import { describe, expect, it, vi, afterEach } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";
import { makeFakeBeli, type FakeBeliOptions } from "./fake-beli.js";

/**
 * Coverage for the silent-undercount bug.
 *
 * `get-ranking` and `get-bookmark` both require a category, so asking for "my
 * Been list" returned one category's rows with nothing signalling that the
 * rest existed. On the real account that showed 388 restaurants for a
 * 548-place list. These tests pin the aggregate behaviour and, just as
 * importantly, that its incompleteness is always stated.
 */

const USER = "902c99ec-31bb-4c2b-bb65-2bd8c6848b91";

const PER_CATEGORY: Record<string, number[]> = {
  RES: [1, 2, 3, 4],
  BAR: [10, 11],
  BAK: [20],
  DES: [30, 31, 32],
};

afterEach(() => vi.unstubAllGlobals());

/** Fake whose category buckets mirror the real account's shape. */
function stubMultiCategory(opts: Partial<FakeBeliOptions> = {}) {
  const base = makeFakeBeli({ beenIds: [], wantToTryIds: [], filterList: {}, ...opts });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      const cat = u.searchParams.get("category") ?? "RES";
      if (u.pathname === "/api/get-ranking/") {
        const ids = PER_CATEGORY[cat] ?? [];
        return new Response(
          JSON.stringify({
            results: ids.map((id) => ({
              id: id + 1000,
              user: USER,
              business: { id, name: `B${id}` },
              score: 8,
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.pathname === "/api/get-bookmark/") {
        const ids = PER_CATEGORY[cat] ?? [];
        return new Response(
          JSON.stringify({
            [cat]: ids.map((id) => ({ id: id + 2000, user: USER, business: { id, name: `B${id}` } })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return base.fetch(String(url), init);
    }),
  );
}

async function client() {
  const c = new BeliClient({
    email: "tester@example.com",
    password: "irrelevant",
    store: new MemorySessionStore(),
    guard: { minIntervalMs: 0 },
  });
  await c.init();
  return c;
}

describe("all-category aggregation", () => {
  it("returns every confirmed category, not just restaurants", async () => {
    stubMultiCategory();
    const res = await (await client()).allBeen();

    // 4 + 2 + 1 + 3 across RES/BAR/BAK/DES, versus 4 for RES alone.
    expect(res.entries).toHaveLength(10);
    expect(res.byCategory).toEqual({ RES: 4, BAR: 2, BAK: 1, DES: 3 });
  });

  it("always states that the total is still incomplete", async () => {
    stubMultiCategory();
    const res = await (await client()).allBeen();
    // Coffee & Tea has no confirmed code, so even this aggregate is short.
    // Presenting it as final would be a bigger version of the original bug.
    expect(res.incompleteReason).toMatch(/coffee/i);
  });

  it("aggregates Want-to-Try the same way", async () => {
    stubMultiCategory();
    const res = await (await client()).allWantToTry();
    expect(res.entries).toHaveLength(10);
    expect(res.byCategory).toEqual({ RES: 4, BAR: 2, BAK: 1, DES: 3 });
  });

  it("records a failed category instead of dropping it silently", async () => {
    // get-bookmark answers 500 for an unknown code, so a category can fail
    // mid-aggregate. The total must not quietly shrink.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(String(url));
        if (u.pathname === "/api/token/") {
          return new Response(JSON.stringify({ access: fakeJwt(), refresh: "r" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const cat = u.searchParams.get("category") ?? "RES";
        if (cat === "BAK") {
          return new Response('{"detail":"Internal Server Error"}', { status: 500 });
        }
        const ids = PER_CATEGORY[cat] ?? [];
        return new Response(
          JSON.stringify({
            results: ids.map((id) => ({
              id: id + 1000,
              user: USER,
              business: { id, name: `B${id}` },
              score: 8,
            })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const res = await (await client()).allBeen();
    expect(Object.keys(res.failedCategories)).toEqual(["BAK"]);
    expect(res.byCategory.BAK).toBeUndefined();
    // The categories that did work are still returned.
    expect(res.entries).toHaveLength(9);
  });

  it("stops the whole aggregate when the guard trips mid-way", async () => {
    // An account-level rejection must abort, not be logged per-category and
    // then hammered three more times.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(String(url));
        if (u.pathname === "/api/token/") {
          return new Response(JSON.stringify({ access: fakeJwt(), refresh: "r" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        calls += 1;
        return new Response('{"detail":"User is inactive","code":"user_inactive"}', {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const c = await client();
    await expect(c.allBeen()).rejects.toThrow(/refused this account/i);
    expect(c.guard.isTripped).toBe(true);
    // Must not have marched through the remaining categories.
    expect(calls).toBeLessThanOrEqual(2);
  });
});

function fakeJwt() {
  const body = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 1200, user_id: USER }),
  ).toString("base64url");
  return `h.${body}.s`;
}
