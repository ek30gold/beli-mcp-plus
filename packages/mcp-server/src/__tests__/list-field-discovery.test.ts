import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";
import { loadConfig } from "../config.js";
import { runProbe } from "../probe.js";
import { makeFakeBeli, type FakeBeliOptions } from "./fake-beli.js";

/**
 * The probe gets ONE shot at classifying `list_field` against a live account.
 * These tests give it a world with known ground truth and check that it either
 * gets the right answer or admits it doesn't know — never a confident wrong one.
 */

const BEEN = [101, 102, 103, 104, 105];
const WANT = [201, 202, 203, 204, 205];

async function probeAgainst(opts: FakeBeliOptions, dir: string) {
  const fake = makeFakeBeli(opts);
  vi.stubGlobal("fetch", vi.fn(fake.fetch));
  const config = loadConfig({
    BELI_HOME: dir,
    BELI_MIN_INTERVAL_MS: "0",
    BELI_EMAIL: "tester@example.com",
    BELI_PASSWORD: "irrelevant",
  });
  const client = new BeliClient({
    email: "tester@example.com",
    password: "irrelevant",
    store: new MemorySessionStore(),
  });
  await client.init();
  const report = await runProbe({ client, config });
  return { report, fake };
}

describe("list_field discovery against known ground truth", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-lf-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("resolves both lists by id-overlap when the API cooperates", async () => {
    const { report } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: { RANKED: BEEN, BOOKMARK: WANT, TRENDING: [901, 902] },
      },
      dir,
    );

    expect(report.listField.skipped).toBe(false);
    expect(report.listField.bestBeenCandidate).toBe("RANKED");
    expect(report.listField.bestWantToTryCandidate).toBe("BOOKMARK");
  });

  it("classifies by ids, NOT by plausible names", async () => {
    // The exact trap the discovery task called out: a field *named* BEEN that
    // actually returns the bookmark list must be reported as Want-to-Try.
    const { report } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: { BEEN: WANT, RANKED: BEEN },
      },
      dir,
    );

    expect(report.listField.bestWantToTryCandidate).toBe("BEEN");
    expect(report.listField.bestBeenCandidate).toBe("RANKED");
    const been = report.listField.candidates.find((c) => c.candidate === "BEEN");
    expect(been?.conclusion).toContain("WANT_TO_TRY");
  });

  it("reports no resolution when nothing matches either list", async () => {
    const { report } = await probeAgainst(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { TRENDING: [901, 902, 903] } },
      dir,
    );
    expect(report.listField.bestBeenCandidate).toBeNull();
    expect(report.listField.bestWantToTryCandidate).toBeNull();
  });

  it("does not claim a resolution when filter-list rejects every candidate", async () => {
    const { report } = await probeAgainst(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: {} },
      dir,
    );
    expect(report.listField.bestBeenCandidate).toBeNull();
    expect(report.listField.bestWantToTryCandidate).toBeNull();
    expect(report.listField.candidates.every((c) => !c.ok)).toBe(true);
  });

  it("NEVER assigns one candidate to both lists", async () => {
    // A field returning a 50/50 mix clears the overlap threshold against BOTH
    // references. Reporting it as Been and Want-to-Try at once is a confident
    // contradiction; it must come back unresolved and be named as ambiguous.
    const bothIds = [...BEEN.slice(0, 3), ...WANT.slice(0, 3)];
    const { report } = await probeAgainst(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { RANKED: bothIds } },
      dir,
    );
    const { bestBeenCandidate, bestWantToTryCandidate } = report.listField;
    expect(bestBeenCandidate).toBeNull();
    expect(bestWantToTryCandidate).toBeNull();

    const ranked = report.listField.candidates.find((c) => c.candidate === "RANKED");
    expect(ranked?.conclusion).toContain("AMBIGUOUS");
  });

  it("still resolves a mostly-but-not-perfectly matching field", async () => {
    // The ambiguity guard must not make the probe useless: 4 of 5 Been ids plus
    // one stranger is still decisively the Been list.
    const { report } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: { RANKED: [...BEEN.slice(0, 4), 999] },
      },
      dir,
    );
    expect(report.listField.bestBeenCandidate).toBe("RANKED");
    expect(report.listField.bestWantToTryCandidate).toBeNull();
  });

  it("resolves Been even when the account has no bookmarks at all", async () => {
    // An empty Want-to-Try list is a real account state, distinct from a failed
    // fetch, and must not block resolving the other list.
    const { report } = await probeAgainst(
      { beenIds: BEEN, wantToTryIds: [], filterList: { RANKED: BEEN } },
      dir,
    );
    expect(report.listField.wantToTryIdCount).toBe(0);
    expect(report.listField.bestBeenCandidate).toBe("RANKED");
  });

  it("says a reference was unavailable rather than calling the overlap zero", async () => {
    const { report } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        failGetRanking: true,
        filterList: { RANKED: BEEN },
      },
      dir,
    );
    const ranked = report.listField.candidates.find((c) => c.candidate === "RANKED");
    expect(ranked?.conclusion).toContain("unavailable");
    expect(ranked?.conclusion).toContain("get-ranking failed");
  });

  it("does NOT mistake a failed Been fetch for an empty Been list", async () => {
    // If get-ranking errors, the Been reference is unknown, not empty. A
    // candidate returning the Been ids would then show 0/5 Been overlap and
    // could be misfiled as something else. The report must not present a
    // confident classification built on a reference it never obtained.
    const { report } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        failGetRanking: true,
        filterList: { RANKED: BEEN, BOOKMARK: WANT },
      },
      dir,
    );

    expect(report.listField.beenIdCount).toBeNull();
    // RANKED really is the Been field, but Been could not be measured — so it
    // must not be reported as resolved.
    expect(report.listField.bestBeenCandidate).toBeNull();
  });

  it("does NOT misfile a Been field as Want-to-Try when Been is unmeasurable", async () => {
    const { report } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        failGetRanking: true,
        filterList: { RANKED: BEEN },
      },
      dir,
    );
    expect(report.listField.bestWantToTryCandidate).not.toBe("RANKED");
  });

  it("tries the documented candidate list plus facet-config hints", async () => {
    const { report, fake } = await probeAgainst(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: { RANKED: BEEN },
        filterConfigs: { facets: [{ key: "LIST_FIELD", options: ["CUSTOM_HINT"] }] },
      },
      dir,
    );
    expect(fake.listFieldsTried).toEqual(expect.arrayContaining(["TRENDING", "BEEN", "RANKED"]));
    expect(report.listField.candidates.length).toBeGreaterThan(5);
  });
});
