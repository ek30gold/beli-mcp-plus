import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";
import { loadConfig } from "../config.js";
import { renderDiscovered } from "../discovered-gen.js";
import { runProbe } from "../probe.js";
import { makeFakeBeli, type FakeBeliOptions } from "./fake-beli.js";

const BEEN = [101, 102, 103, 104, 105];
const WANT = [201, 202, 203, 204, 205];

async function reportFrom(opts: FakeBeliOptions, dir: string) {
  vi.stubGlobal("fetch", vi.fn(makeFakeBeli(opts).fetch));
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
  return runProbe({ client, config });
}

describe("renderDiscovered", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-gen-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("emits CONFIRMED list_field values with the overlap evidence quoted", async () => {
    const report = await reportFrom(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { RANKED: BEEN, BOOKMARK: WANT } },
      dir,
    );
    const out = renderDiscovered(report);

    expect(out).toContain('BEEN: "RANKED"');
    expect(out).toContain('WANT_TO_TRY: "BOOKMARK"');
    expect(out).toContain("CONFIRMED");
    // The evidence, not just the verdict.
    expect(out).toContain("get-ranking");
    expect(out).toContain("get-bookmark");
    expect(out).toContain("FILTER_LIST_SERVES_PERSONAL_LISTS = true");
  });

  it("emits null + UNRESOLVED rather than a guess when nothing resolved", async () => {
    const report = await reportFrom(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { TRENDING: [901, 902] } },
      dir,
    );
    const out = renderDiscovered(report);

    expect(out).toContain("BEEN: null");
    expect(out).toContain("WANT_TO_TRY: null");
    expect(out).toContain("UNRESOLVED");
    expect(out).toContain("FILTER_LIST_SERVES_PERSONAL_LISTS = false");
    // The trap: a plausible name must never appear as a resolved value.
    expect(out).not.toContain('BEEN: "BEEN"');
  });

  it("records the account and generation date in the header", async () => {
    const report = await reportFrom(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { RANKED: BEEN } },
      dir,
    );
    const out = renderDiscovered(report);
    expect(out).toContain("GENERATED FILE");
    expect(out).toContain(report.session.userId!);
    expect(out).toContain(report.generatedAt);
  });

  it("marks everything unresolved when the probe never authenticated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const config = loadConfig({ BELI_HOME: dir, BELI_MIN_INTERVAL_MS: "0" });
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();
    const report = await runProbe({ client, config });

    const out = renderDiscovered(report);
    expect(out).toContain("Authenticated: NO");
    expect(out).toContain("BEEN: null");
    expect(out).toContain("CATEGORIES = [] as const");
    expect(out).toContain("FILTER_LIST_SERVES_PERSONAL_LISTS = false");
  });

  it("only reports the categories the API actually accepted", async () => {
    const report = await reportFrom(
      {
        beenIds: BEEN,
        wantToTryIds: WANT,
        filterList: { RANKED: BEEN },
        acceptedCategories: ["RES", "BAR"],
      },
      dir,
    );
    const out = renderDiscovered(report);
    expect(out).toContain('"RES"');
    expect(out).toContain('"BAR"');
    expect(out).not.toContain('"BAKERY"');
  });

  it("produces a file that actually compiles as TypeScript", async () => {
    const report = await reportFrom(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { RANKED: BEEN, BOOKMARK: WANT } },
      dir,
    );
    const file = join(dir, "discovered.ts");
    await writeFile(file, renderDiscovered(report), "utf8");

    const ts = await import("typescript");
    const source = ts.default.createSourceFile(
      file,
      renderDiscovered(report),
      ts.default.ScriptTarget.ES2022,
      true,
    );
    // A syntactically broken emit shows up as parse diagnostics.
    expect((source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toHaveLength(0);
  });
});

describe("renderDiscovered — recs shape honesty", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-gen2-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("does NOT call an empty recs response a confirmed shape", async () => {
    // The fake's recs endpoints return {results: []}. That proves the call
    // worked, not whether recs is a curated list or a score map.
    const report = await reportFrom(
      { beenIds: BEEN, wantToTryIds: WANT, filterList: { RANKED: BEEN } },
      dir,
    );
    const out = renderDiscovered(report);
    const recsBlock = out.slice(out.indexOf("Shape of the recs endpoints"));
    expect(recsBlock).toContain("UNRESOLVED");
    expect(recsBlock).not.toContain("CONFIRMED");
  });
});
