import { afterEach, describe, expect, it, vi } from "vitest";
import { BeliClient, MemorySessionStore, type ListFilter, type ListName } from "@beli/client";
import { LIST_FIELD } from "@beli/contract";
import { makeFakeBeli } from "./fake-beli.js";

/**
 * The "server" ListBackend (BeliClient.searchList(..., "server")) against the
 * exact same fixtures `stack-e2e.test.ts` uses for the default "client"
 * backend — so any behavioral divergence between the two shows up here rather
 * than being caught by neither.
 *
 * `LIST_FIELD` comes from `@beli/contract`'s generated discovered.ts, never
 * hardcoded — the whole point of this backend existing at all is that the
 * plausible-looking candidate names ("BEEN", "WANT_TO_TRY") are NOT the
 * confirmed values (see discovered.ts's header evidence: they return zero
 * rows live; "RANK"/"BOOKMARKED" are what actually resolved).
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

// Ground truth for POST /api/filter-list/, keyed by the CONFIRMED list_field
// values — matches what get-ranking/get-bookmark already report for this
// fixture account, exactly as the live probe found (388/388, 568/568 overlap).
const fullFilterList = {
  [LIST_FIELD.BEEN]: BEEN,
  [LIST_FIELD.WANT_TO_TRY]: WANT,
};

describe("search_list server backend vs. client backend (same fixtures)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls filter-list with the confirmed list_field, not a plausible-looking name", async () => {
    const { client, fake } = await loggedInClient({
      beenIds: BEEN,
      wantToTryIds: WANT,
      filterList: fullFilterList,
    });
    await client.searchList("been", "RES", {}, undefined, "server");
    await client.searchList("want_to_try", "RES", {}, undefined, "server");

    expect(fake.listFieldsTried).toEqual([LIST_FIELD.BEEN, LIST_FIELD.WANT_TO_TRY]);
    expect(fake.filterListCalls[0]).toMatchObject({
      list_field: LIST_FIELD.BEEN,
      category: "RES",
      filters: [],
      bounds: null,
    });
    // user2 IS sent even for a single-user query — matches the live capture.
    expect(fake.filterListCalls[0]?.user2).toBe(fake.filterListCalls[0]?.user);
  });

  const cases: Array<{ name: string; list: ListName; filter: ListFilter }> = [
    { name: "no filter", list: "been", filter: {} },
    { name: "query filter", list: "been", filter: { query: "Been Place 102" } },
    { name: "query filter", list: "want_to_try", filter: { query: "Want Place 201" } },
    { name: "score bound (empties want_to_try)", list: "want_to_try", filter: { minScore: 0 } },
    { name: "sort name_asc + limit/offset page 1", list: "been", filter: { limit: 2, sort: "name_asc" } },
    { name: "sort name_asc + limit/offset page 2", list: "been", filter: { limit: 2, offset: 2, sort: "name_asc" } },
  ];

  for (const { name, list, filter } of cases) {
    it(`"${list}" / ${name}: server backend matches client backend exactly`, async () => {
      const { client: clientBackendClient } = await loggedInClient({
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: fullFilterList,
      });
      const clientResult = await clientBackendClient.searchList(list, "RES", filter);

      vi.unstubAllGlobals();
      const { client: serverBackendClient } = await loggedInClient({
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: fullFilterList,
      });
      const serverResult = await serverBackendClient.searchList(
        list,
        "RES",
        filter,
        undefined,
        "server",
      );

      expect(serverResult).toEqual(clientResult);
    });
  }

  it("scopes results to filter-list's id set even when it diverges from get-ranking/get-bookmark", async () => {
    // A real safety net: if filter-list ever disagreed with get-ranking about
    // list membership, the server backend must defer to filter-list, not
    // silently return the full get-ranking/get-bookmark set.
    const { client } = await loggedInClient({
      beenIds: BEEN,
      wantToTryIds: WANT,
      filterList: { [LIST_FIELD.BEEN]: [BEEN[0]!] },
    });
    const got = await client.searchList("been", "RES", {}, undefined, "server");
    expect(got.map((e) => e.business.id)).toEqual([BEEN[0]]);
  });

  it("rejects a list with no confirmed list_field instead of guessing", async () => {
    const { client } = await loggedInClient({
      beenIds: BEEN,
      wantToTryIds: WANT,
      filterList: fullFilterList,
    });
    // Simulate a future discovered.ts regeneration resolving a list back to
    // null (LIST_FIELD.RECS is a live example of exactly this state) by
    // calling with a list name outside the confirmed set.
    await expect(
      client.searchList("recs" as any, "RES", {}, undefined, "server"),
    ).rejects.toThrow(/no confirmed list_field/i);
  });

  it("defaults to the client backend and never touches filter-list", async () => {
    const { client, fake } = await loggedInClient({
      beenIds: BEEN,
      wantToTryIds: WANT,
      // Empty: any filter-list call at all would 400, proving the default
      // path doesn't call it.
      filterList: {},
    });
    const got = await client.searchList("been", "RES");
    expect(got.map((e) => e.business.id)).toEqual(BEEN);
    expect(fake.listFieldsTried).toEqual([]);
  });
});
