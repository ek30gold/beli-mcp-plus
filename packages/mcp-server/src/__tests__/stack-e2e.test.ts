import { afterEach, describe, expect, it, vi } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";
import { makeFakeBeli } from "./fake-beli.js";

/**
 * End-to-end through the real client against a simulated Beli: login, token
 * handling, URL building, response parsing and list filtering. No network.
 *
 * This is the closest thing to an operational check available while the live
 * API is unreachable — it exercises the wiring, not just the pure helpers.
 */

async function loggedInClient(fakeOpts: Parameters<typeof makeFakeBeli>[0]) {
  const fake = makeFakeBeli(fakeOpts);
  vi.stubGlobal("fetch", vi.fn(fake.fetch));
  const client = new BeliClient({
    email: "tester@example.com",
    password: "irrelevant",
    store: new MemorySessionStore(),
  });
  await client.init();
  await client.login();
  return { client, fake };
}

const BEEN = [101, 102, 103];
const WANT = [201, 202];

describe("full stack against a simulated Beli", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("logs in and resolves the account id from the access token", async () => {
    const { client, fake } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    expect(client.isAuthenticated()).toBe(true);
    expect(client.userId).toBe(fake.userId);
  });

  it("fetches and parses the Been list", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    const been = await client.getBeen("RES");
    expect(been.results.map((r) => r.business.id)).toEqual(BEEN);
  });

  it("fetches and parses the Want-to-Try list from its bucketed shape", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    const wtt = await client.getWantToTry("RES");
    const ids = Object.values(wtt).flat().map((r) => r.business.id);
    expect(ids).toEqual(WANT);
  });

  it("searchList filters the Been list end-to-end", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    const all = await client.searchList("been", "RES");
    expect(all).toHaveLength(3);

    const narrowed = await client.searchList("been", "RES", { query: "Been Place 102" });
    expect(narrowed.map((e) => e.business.id)).toEqual([102]);
  });

  it("searchList filters the Want-to-Try list end-to-end", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    const got = await client.searchList("want_to_try", "RES", { query: "Want Place 201" });
    expect(got.map((e) => e.business.id)).toEqual([201]);
  });

  it("searchList sorts Been by score descending by default", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    const got = await client.searchList("been", "RES");
    const scores = got.map((e) => e.score as number);
    expect([...scores]).toEqual([...scores].sort((a, b) => b - a));
  });

  it("a score bound returns nothing from Want-to-Try, which has no scores", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    expect(await client.searchList("want_to_try", "RES", { minScore: 0 })).toEqual([]);
  });

  it("applies limit and offset over the live-shaped payload", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {},
    });
    const page = await client.searchList("been", "RES", { limit: 2, sort: "name_asc" });
    expect(page).toHaveLength(2);
    const next = await client.searchList("been", "RES", { limit: 2, offset: 2, sort: "name_asc" });
    expect(next).toHaveLength(1);
    // Pages must not overlap.
    const ids = new Set([...page, ...next].map((e) => e.business.id));
    expect(ids.size).toBe(3);
  });

  it("surfaces an API error as a BeliApiError rather than a parse crash", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {}, failGetRanking: true,
    });
    await expect(client.getBeen("RES")).rejects.toThrow(/500/);
  });

  it("rejects a category the API does not accept", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN, wantToTryIds: WANT, filterList: {}, acceptedCategories: ["RES"],
    });
    await expect(client.getBeen("BAR")).rejects.toThrow(/400/);
  });
});
