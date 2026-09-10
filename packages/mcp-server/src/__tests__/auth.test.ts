import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BeliClient, MemorySessionStore, type SessionState } from "@beli/client";
import { FileSessionStore } from "../auth.js";

const SECRET_PASSWORD = "sup3r-s3cret-hunter2!";

describe("FileSessionStore — persists ONLY the refresh token", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-session-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("writes only {refresh} to disk — no access/userId/accessExp, no password field, mode 0600", async () => {
    const sessionPath = join(dir, "session.json");
    const store = new FileSessionStore(sessionPath);

    const state: SessionState = {
      access: "ACCESS_TOKEN_SHOULD_NOT_BE_PERSISTED",
      refresh: "REFRESH_TOKEN_SHOULD_BE_PERSISTED",
      userId: "user-should-not-be-persisted",
      accessExp: 9999999999,
    };
    await store.save(state);

    const raw = await readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual(["refresh"]);
    expect(parsed.refresh).toBe("REFRESH_TOKEN_SHOULD_BE_PERSISTED");
    expect(parsed).not.toHaveProperty("access");
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed).not.toHaveProperty("accessExp");
    expect(parsed).not.toHaveProperty("password");
    expect(raw).not.toContain("ACCESS_TOKEN_SHOULD_NOT_BE_PERSISTED");
    expect(raw).not.toContain("password");

    const st = await stat(sessionPath);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("round-trips: load() after save() restores only the refresh token", async () => {
    const sessionPath = join(dir, "session.json");
    const store = new FileSessionStore(sessionPath);
    await store.save({
      access: "a",
      refresh: "r",
      userId: "u",
      accessExp: 123,
    });
    const loaded = await store.load();
    expect(loaded).toEqual({ access: null, refresh: "r", userId: null, accessExp: null });
  });

  it("end-to-end: a real login's persisted session.json never contains the password, in any form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
        const access = `h.${b64u({
          exp: Math.floor(Date.now() / 1000) + 1200,
          user_id: "u1",
        })}.s`;
        return new Response(JSON.stringify({ access, refresh: "r1" }), { status: 200 });
      }),
    );

    const sessionPath = join(dir, "session.json");
    const client = new BeliClient({ store: new FileSessionStore(sessionPath) });
    await client.init();
    await client.login({ email: "a@example.com", password: SECRET_PASSWORD });

    const raw = await readFile(sessionPath, "utf8");
    expect(raw).not.toContain(SECRET_PASSWORD);
    expect(raw.toLowerCase()).not.toContain("password");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["refresh"]);
    expect(parsed.refresh).toBe("r1");
  });

  it("in-memory SessionState / SessionStore never carries a password field either", async () => {
    const store = new MemorySessionStore();
    await store.save({ access: "a", refresh: "r", userId: "u", accessExp: 1 });
    const serialized = JSON.stringify(store.load());
    expect(serialized.toLowerCase()).not.toContain("password");
  });
});
