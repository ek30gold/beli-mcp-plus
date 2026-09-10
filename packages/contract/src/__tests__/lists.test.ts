import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BookmarkListResponse, endpoints } from "@beli/contract";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));

describe("lists & guides endpoints", () => {
  it("playlists: parses a results envelope of unknown-shaped playlist rows", () => {
    const res = loadFixture("playlists-response.json");
    const parsed = endpoints.playlists.response.parse(res);
    expect(parsed.results).toHaveLength(2);
  });

  it("shortList: parses a results envelope for a user's short list", () => {
    const res = loadFixture("short-list-response.json");
    expect(() => endpoints.shortList.response.parse(res)).not.toThrow();
    expect(endpoints.shortList.path).toBe("/api/short-list/{uuid}/");
  });

  it("publishedList: parses the documented PublishedList shape (beli.yaml components.schemas.PublishedList)", () => {
    const res = loadFixture("published-list-response.json");
    const parsed = endpoints.publishedList.response.parse(res);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]!.title).toBe("Best Ramen in NYC");
    expect(parsed.results[1]!.challenge_info?.progress).toBe(3);
  });

  it("publishedListByUuid: parses a per-author PublishedList response", () => {
    const res = loadFixture("published-list-by-uuid-response.json");
    const parsed = endpoints.publishedListByUuid.response.parse(res);
    expect(parsed.results[0]!.id).toBe(9003);
    expect(endpoints.publishedListByUuid.path).toBe("/api/published-list/{uuid}/");
  });

  it("publishedListItemNew: parses a results envelope of unknown-shaped list items", () => {
    const res = loadFixture("published-list-item-new-response.json");
    expect(() => endpoints.publishedListItemNew.response.parse(res)).not.toThrow();
  });

  it("publishedListCities: parses a results envelope of cities", () => {
    const res = loadFixture("published-list-cities-response.json");
    const parsed = endpoints.publishedListCities.response.parse(res);
    expect(parsed.results).toEqual(["New York", "Los Angeles", "London"]);
  });
});

describe("BookmarkListResponse tolerance", () => {
  const uuid = "11111111-2222-3333-4444-555555555555";
  const row = { id: 1, user: uuid, business: { id: 10, name: "A" } };

  it("parses the plain bucketed shape", () => {
    const got = BookmarkListResponse.parse({ Restaurants: [row] });
    expect(got.Restaurants).toHaveLength(1);
  });

  it("survives an added scalar metadata key instead of rejecting everything", () => {
    // A single new sibling key used to take out the whole Want-to-Try list.
    const got = BookmarkListResponse.parse({ Restaurants: [row], count: 1, next: null });
    expect(Object.keys(got)).toEqual(["Restaurants"]);
    expect(got.Restaurants).toHaveLength(1);
  });

  it("keeps multiple buckets", () => {
    const got = BookmarkListResponse.parse({ Restaurants: [row], Bars: [row] });
    expect(Object.keys(got).sort()).toEqual(["Bars", "Restaurants"]);
  });

  it("still fails loudly when a bucket's ROW shape actually changes", () => {
    // Tolerating a new key must not become tolerating silent data loss.
    expect(() => BookmarkListResponse.parse({ Restaurants: [{ nope: true }] })).toThrow();
  });

  it("returns an empty object for a response with no buckets", () => {
    expect(BookmarkListResponse.parse({ count: 0 })).toEqual({});
  });
});
