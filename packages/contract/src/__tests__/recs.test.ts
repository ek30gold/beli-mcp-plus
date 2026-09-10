import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { endpoints } from "@beli/contract";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));

describe("recs endpoints", () => {
  it("recs: lives on the RECS host and accepts a bare array (belimaps shape)", () => {
    expect(endpoints.recs.host).toBe("RECS");
    const res = loadFixture("recs-response.json");
    const parsed = endpoints.recs.response.parse(res);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed[0]!.business_id).toBe(7316);
    }
  });

  it("recs: also accepts a results-wrapped envelope", () => {
    const wrapped = { results: loadFixture("recs-response.json") };
    expect(() => endpoints.recs.response.parse(wrapped)).not.toThrow();
  });

  it("recScore: lives on the API host and accepts an unmodeled object", () => {
    expect(endpoints.recScore.host).toBe("API");
    const res = loadFixture("rec-score-response.json");
    expect(() => endpoints.recScore.response.parse(res)).not.toThrow();
  });

  it("userRecScores: request and response are permissive", () => {
    expect(endpoints.userRecScores.method).toBe("POST");
    expect(() => endpoints.userRecScores.request!.parse({ user: "u1" })).not.toThrow();
    const res = loadFixture("user-rec-scores-response.json");
    expect(() => endpoints.userRecScores.response.parse(res)).not.toThrow();
  });
});
