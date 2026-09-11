import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig — credential resolution order", () => {
  let dir: string;
  let stderr: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-config-test-"));
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const baseEnv = (): NodeJS.ProcessEnv => ({ BELI_HOME: dir });

  it("(a) env vars win when present: BELI_EMAIL + BELI_PASSWORD", () => {
    const config = loadConfig({
      ...baseEnv(),
      BELI_EMAIL: "env@example.com",
      BELI_PASSWORD: "env-pass",
    });
    expect(config.email).toBe("env@example.com");
    expect(config.phone).toBeUndefined();
    expect(config.password).toBe("env-pass");
  });

  it("(a) BELI_PHONE + BELI_PASSWORD also resolves via env", () => {
    const config = loadConfig({
      ...baseEnv(),
      BELI_PHONE: "+15551234567",
      BELI_PASSWORD: "env-pass",
    });
    expect(config.phone).toBe("+15551234567");
    expect(config.email).toBeUndefined();
  });

  it("(b) falls back to $BELI_HOME/config.json (mode 0600) when env is absent", async () => {
    const configPath = join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ email: "file@example.com", password: "file-pass" }),
    );
    await chmod(configPath, 0o600);

    const config = loadConfig(baseEnv());
    expect(config.email).toBe("file@example.com");
    expect(config.password).toBe("file-pass");
    expect(config.configPath).toBe(configPath);
  });

  it("(a) beats (b): env vars are used even when a valid config.json also exists", async () => {
    const configPath = join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ email: "file@example.com", password: "file-pass" }),
    );
    await chmod(configPath, 0o600);

    const config = loadConfig({
      ...baseEnv(),
      BELI_EMAIL: "env@example.com",
      BELI_PASSWORD: "env-pass",
    });
    expect(config.email).toBe("env@example.com");
  });

  it("ignores a world-readable config.json and warns on stderr instead of reading it", async () => {
    const configPath = join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ email: "file@example.com", password: "file-pass" }),
    );
    await chmod(configPath, 0o644); // more open than 0600

    const config = loadConfig(baseEnv());
    expect(config.email).toBeUndefined();
    expect(config.password).toBeUndefined();
    expect(stderr.join("\n")).toMatch(/more open than 0600/i);
  });

  it("(c) neither env nor a usable config file resolves any credential (falls through to interactive login)", () => {
    const config = loadConfig(baseEnv());
    expect(config.email).toBeUndefined();
    expect(config.phone).toBeUndefined();
    expect(config.password).toBeUndefined();
  });

  it("a config.json missing a password does not count as a usable source", async () => {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ email: "file@example.com" }));
    await chmod(configPath, 0o600);

    const config = loadConfig(baseEnv());
    expect(config.email).toBeUndefined();
    expect(config.password).toBeUndefined();
  });
});

describe("loadConfig — BELI_LIST_BACKEND", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "beli-config-listbackend-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to client-side filtering when unset", () => {
    expect(loadConfig({ BELI_HOME: dir }).listBackend).toBe("client");
  });

  it("switches to the server backend only on an exact 'server' value", () => {
    expect(loadConfig({ BELI_HOME: dir, BELI_LIST_BACKEND: "server" }).listBackend).toBe("server");
  });

  it("treats any other value as client-side rather than erroring", () => {
    expect(loadConfig({ BELI_HOME: dir, BELI_LIST_BACKEND: "SERVER" }).listBackend).toBe("client");
    expect(loadConfig({ BELI_HOME: dir, BELI_LIST_BACKEND: "bogus" }).listBackend).toBe("client");
  });
});
