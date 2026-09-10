import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { endpoints } from "@beli/contract";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));

describe("discovery endpoints", () => {
  it("filterList: parses the observed request body (beli-api-reference.md §6)", () => {
    const body = loadFixture("filter-list-request.json");
    expect(() => endpoints.filterList.request!.parse(body)).not.toThrow();
    const parsed = endpoints.filterList.request!.parse(body);
    expect(parsed.list_field).toBe("TRENDING");
    expect(parsed.filters).toHaveLength(2);
  });

  it("filterList: parses a representative response", () => {
    const res = loadFixture("filter-list-response.json");
    const parsed = endpoints.filterList.response.parse(res);
    expect(parsed.results).toEqual([7316, 84, 1727551]);
    expect(parsed.count).toBe(3);
  });

  it("filterConfigs: accepts an unknown facet-config object", () => {
    const res = loadFixture("filter-configs-response.json");
    expect(() => endpoints.filterConfigs.response.parse(res)).not.toThrow();
  });

  it("filterOptions: request and response are permissive", () => {
    expect(() => endpoints.filterOptions.request!.parse({})).not.toThrow();
    const res = loadFixture("filter-options-response.json");
    expect(() => endpoints.filterOptions.response.parse(res)).not.toThrow();
  });

  it("allCities: parses a results envelope of unknown-shaped city rows", () => {
    const res = loadFixture("all-cities-response.json");
    const parsed = endpoints.allCities.response.parse(res);
    expect(parsed.results).toHaveLength(2);
  });

  it("allCuisines: parses a results envelope of unknown-shaped cuisine rows", () => {
    const res = loadFixture("all-cuisines-response.json");
    const parsed = endpoints.allCuisines.response.parse(res);
    expect(parsed.results).toEqual(["Italian", "Japanese", "Thai", "New American"]);
  });

  it("registers filter/discovery endpoints on the right hosts", () => {
    expect(endpoints.filterList.host).toBe("API");
    expect(endpoints.filterList.method).toBe("POST");
    expect(endpoints.filterConfigs.method).toBe("GET");
    expect(endpoints.allCities.path).toBe("/api/all-cities/");
    expect(endpoints.allCuisines.path).toBe("/api/cuisine/all-cuisines/");
  });
});
