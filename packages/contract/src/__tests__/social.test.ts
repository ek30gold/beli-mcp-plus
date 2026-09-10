import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { endpoints } from "@beli/contract";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));

describe("social endpoints", () => {
  it("followers: parses a MemberSummary results envelope (belimaps MemberListResponse)", () => {
    const res = loadFixture("followers-response.json");
    const parsed = endpoints.followers.response.parse(res);
    expect(parsed.results[0]!.username).toBe("janedoe");
  });

  it("following: parses a MemberSummary results envelope", () => {
    const res = loadFixture("following-response.json");
    const parsed = endpoints.following.response.parse(res);
    expect(parsed.results[0]!.username).toBe("jsmith");
  });

  it("friendsBookmarked: parses a results envelope with unmodeled item shape", () => {
    const res = loadFixture("friends-bookmarked-response.json");
    expect(() => endpoints.friendsBookmarked.response.parse(res)).not.toThrow();
    expect(endpoints.friendsBookmarked.path).toBe(
      "/api/friends-bookmarked/{uuid}/{id}/",
    );
  });

  it("mutualBookmarks: parses a results envelope with unmodeled item shape", () => {
    const res = loadFixture("mutual-bookmarks-response.json");
    expect(() => endpoints.mutualBookmarks.response.parse(res)).not.toThrow();
    // Comma-joined single path segment, not two separate {uuid1}/{uuid2} segments.
    expect(endpoints.mutualBookmarks.path).toBe(
      "/api/mutual-bookmarks/{uuid1},{uuid2}/",
    );
  });
});
