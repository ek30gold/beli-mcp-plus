import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { endpoints } from "@beli/contract";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));

describe("deleteRanking", () => {
  it("is a PUT that accepts an empty body, per the observed self-reverting rating flow", () => {
    expect(endpoints.deleteRanking.method).toBe("PUT");
    expect(endpoints.deleteRanking.path).toBe("/api/delete-ranking/{uuid}/{id}/");
    expect(() => endpoints.deleteRanking.request!.parse({})).not.toThrow();
  });

  it("parses the observed response { guide_items_removed }", () => {
    const res = loadFixture("delete-ranking-response.json");
    const parsed = endpoints.deleteRanking.response.parse(res);
    expect(parsed.guide_items_removed).toBe(true);
  });
});
