import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BeliClient, MemorySessionStore } from "@beli/client";

describe("BeliClient.login (email-or-phone)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects supplying BOTH email and phone with a clean error, no fetch call", async () => {
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();
    await expect(
      client.login({ email: "a@example.com", phone: "+15551234567", password: "x" }),
    ).rejects.toThrow(/exactly one of email or phone/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects supplying NEITHER email nor phone with a clean error, no fetch call", async () => {
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();
    await expect(client.login({ password: "x" } as never)).rejects.toThrow(
      /email or phone/i,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing password with a clean error, no fetch call", async () => {
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();
    await expect(
      client.login({ email: "a@example.com" } as never),
    ).rejects.toThrow(/password/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a deliberately malformed email as a clean validation error, not an unhandled exception, with no network call", async () => {
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();
    // A malformed email must fail via a normal rejected promise / thrown Error
    // (caught here), never an unhandled rejection or process crash.
    await expect(
      client.login({ email: "not-an-email", password: "x" }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed phone number cleanly, with no network call", async () => {
    const client = new BeliClient({ store: new MemorySessionStore() });
    await client.init();
    await expect(
      client.login({ phone: "555-CALL-NOW", password: "x" }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends {email, password} (not phone_no) for an email login", async () => {
    const store = new MemorySessionStore();
    const client = new BeliClient({ store });
    await client.init();
    const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const access = `h.${b64u({ exp: Math.floor(Date.now() / 1000) + 1200, user_id: "u1" })}.s`;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access, refresh: "r1" }), { status: 200 }),
    );
    await client.login({ email: "a@example.com", password: "x" });
    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ email: "a@example.com", password: "x" });
    expect(client.isAuthenticated()).toBe(true);
  });

  it("sends {phone_no, password} for a phone login", async () => {
    const store = new MemorySessionStore();
    const client = new BeliClient({ store });
    await client.init();
    const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const access = `h.${b64u({ exp: Math.floor(Date.now() / 1000) + 1200, user_id: "u1" })}.s`;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access, refresh: "r1" }), { status: 200 }),
    );
    await client.login({ phone: "+15551234567", password: "x" });
    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ phone_no: "+15551234567", password: "x" });
  });
});
