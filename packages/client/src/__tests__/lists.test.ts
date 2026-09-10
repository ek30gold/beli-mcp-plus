import { describe, expect, it } from "vitest";
import type { Business } from "@beli/contract";
import {
  filterListEntries,
  normalizeBeen,
  normalizeWantToTry,
  sortListEntries,
  type ListEntry,
} from "../lists.js";

const biz = (over: Partial<Business> & { id: number; name: string }): Business =>
  ({ ...over }) as Business;

const entry = (
  id: number,
  name: string,
  over: Partial<Business> = {},
  score?: number | null,
): ListEntry => ({ id, business: biz({ id, name, ...over }), score });

const sample: ListEntry[] = [
  entry(1, "Le Bernardin", { city: "New York", neighborhood: "Midtown", cuisines: ["French", "Seafood"], price: 4 }, 9.8),
  entry(2, "Joe's Pizza", { city: "New York", neighborhood: "West Village", cuisines: ["Pizza", "Italian"], price: 1 }, 8.1),
  entry(3, "Tartine Bakery", { city: "San Francisco", neighborhood: "Mission", cuisines: ["Bakery"], price: 2 }, 8.1),
  entry(4, "Unscored Spot", { city: "Austin", cuisines: ["BBQ"], price: 2 }, null),
];

const names = (e: ListEntry[]) => e.map((x) => x.business.name);

describe("normalizeBeen", () => {
  it("flattens {results:[...]} and preserves score", () => {
    const got = normalizeBeen({
      results: [{ id: 7, business: biz({ id: 70, name: "A" }), score: 9.1 }],
    });
    expect(got).toEqual([{ id: 7, business: biz({ id: 70, name: "A" }), score: 9.1 }]);
  });

  it("normalizes a missing score to null rather than dropping the row", () => {
    const got = normalizeBeen({ results: [{ id: 7, business: biz({ id: 70, name: "A" }) }] });
    expect(got[0].score).toBeNull();
  });
});

describe("normalizeWantToTry", () => {
  it("flattens category-keyed buckets and records the bucket", () => {
    const got = normalizeWantToTry({
      Restaurants: [{ id: 1, business: biz({ id: 10, name: "A" }) }],
      Bars: [{ id: 2, business: biz({ id: 20, name: "B" }) }],
    });
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.bucket).sort()).toEqual(["Bars", "Restaurants"]);
  });

  it("ignores non-array values instead of throwing on metadata keys", () => {
    const got = normalizeWantToTry({
      Restaurants: [{ id: 1, business: biz({ id: 10, name: "A" }) }],
      count: 1 as unknown as Array<{ id: number; business: Business }>,
    });
    expect(got).toHaveLength(1);
  });

  it("returns an empty array for an empty list", () => {
    expect(normalizeWantToTry({})).toEqual([]);
  });
});

describe("filterListEntries", () => {
  it("returns everything (score-sorted) with no filter", () => {
    expect(names(filterListEntries(sample))).toEqual([
      "Le Bernardin", "Joe's Pizza", "Tartine Bakery", "Unscored Spot",
    ]);
  });

  it("matches query against name case-insensitively", () => {
    expect(names(filterListEntries(sample, { query: "joe's" }))).toEqual(["Joe's Pizza"]);
  });

  it("matches query against cuisine and neighborhood too", () => {
    expect(names(filterListEntries(sample, { query: "seafood" }))).toEqual(["Le Bernardin"]);
    expect(names(filterListEntries(sample, { query: "mission" }))).toEqual(["Tartine Bakery"]);
  });

  it("filters by city", () => {
    expect(names(filterListEntries(sample, { city: "new york" }))).toEqual([
      "Le Bernardin", "Joe's Pizza",
    ]);
  });

  it("filters by cuisine", () => {
    expect(names(filterListEntries(sample, { cuisine: "italian" }))).toEqual(["Joe's Pizza"]);
  });

  it("filters by price range inclusively", () => {
    expect(names(filterListEntries(sample, { minPrice: 2, maxPrice: 2 })).sort()).toEqual([
      "Tartine Bakery", "Unscored Spot",
    ]);
  });

  it("filters by score range inclusively", () => {
    expect(names(filterListEntries(sample, { minScore: 8.1, maxScore: 9.0 }))).toEqual([
      "Joe's Pizza", "Tartine Bakery",
    ]);
  });

  it("EXCLUDES unscored rows when a score bound is set", () => {
    // Keeping them would misreport an unscored place as clearing the floor.
    expect(names(filterListEntries(sample, { minScore: 0 }))).not.toContain("Unscored Spot");
  });

  it("empties a Want-to-Try list under any score bound, since it has no scores", () => {
    const wtt = normalizeWantToTry({ Restaurants: [{ id: 1, business: biz({ id: 10, name: "A" }) }] });
    expect(filterListEntries(wtt, { minScore: 0 })).toEqual([]);
  });

  it("excludes rows with no price when a price bound is set", () => {
    const noPrice = [entry(9, "No Price", { city: "Austin" }, 5)];
    expect(filterListEntries(noPrice, { maxPrice: 4 })).toEqual([]);
  });

  it("combines filters conjunctively", () => {
    expect(names(filterListEntries(sample, { city: "new york", maxPrice: 1 }))).toEqual([
      "Joe's Pizza",
    ]);
  });

  it("applies limit and offset after sorting", () => {
    expect(names(filterListEntries(sample, { limit: 2 }))).toEqual(["Le Bernardin", "Joe's Pizza"]);
    expect(names(filterListEntries(sample, { limit: 2, offset: 1 }))).toEqual([
      "Joe's Pizza", "Tartine Bakery",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterListEntries(sample, { query: "nonexistent" })).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before = [...sample];
    filterListEntries(sample, { sort: "name_asc" });
    expect(sample).toEqual(before);
  });
});

describe("sortListEntries", () => {
  it("sorts by score descending by default, unscored last", () => {
    expect(names(sortListEntries(sample))).toEqual([
      "Le Bernardin", "Joe's Pizza", "Tartine Bakery", "Unscored Spot",
    ]);
  });

  it("keeps unscored rows last even when sorting ascending", () => {
    // An unscored row is unknown, not zero — it must not lead an ascending sort.
    expect(names(sortListEntries(sample, "score_asc")).at(-1)).toBe("Unscored Spot");
  });

  it("breaks score ties on name so paging is stable", () => {
    // Joe's Pizza and Tartine Bakery both score 8.1.
    expect(names(sortListEntries(sample, "score_desc")).slice(1, 3)).toEqual([
      "Joe's Pizza", "Tartine Bakery",
    ]);
  });

  it("sorts by name in both directions", () => {
    expect(names(sortListEntries(sample, "name_asc"))).toEqual([
      "Joe's Pizza", "Le Bernardin", "Tartine Bakery", "Unscored Spot",
    ]);
    expect(names(sortListEntries(sample, "name_desc"))).toEqual([
      "Unscored Spot", "Tartine Bakery", "Le Bernardin", "Joe's Pizza",
    ]);
  });
});
