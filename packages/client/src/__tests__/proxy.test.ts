import { describe, expect, it } from "vitest";
import { installProxySupport, redactProxyUrl } from "../proxy.js";

describe("redactProxyUrl", () => {
  it("keeps a credential-free proxy URL readable", () => {
    expect(redactProxyUrl("http://127.0.0.1:40183")).toBe("http://127.0.0.1:40183");
  });

  it("strips credentials so the URL can be logged", () => {
    const got = redactProxyUrl("http://user:hunter2@proxy.internal:8080");
    expect(got).toContain("http://proxy.internal:8080");
    expect(got).toContain("credentials redacted");
    expect(got).not.toContain("hunter2");
    expect(got).not.toContain("user");
  });

  it("returns null rather than echoing an unparseable value", () => {
    expect(redactProxyUrl("not a url")).toBeNull();
  });
});

describe("installProxySupport", () => {
  it("reports no proxy when the environment has none", async () => {
    const got = await installProxySupport({});
    expect(got.mode).toBe("none");
    expect(got.warning).toBeUndefined();
  });

  it("defers to Node's own env-proxy support when enabled", async () => {
    const got = await installProxySupport({
      HTTPS_PROXY: "http://127.0.0.1:40183",
      NODE_USE_ENV_PROXY: "1",
    });
    expect(got.mode).toBe("node-env-proxy");
    expect(got.warning).toBeUndefined();
  });

  it("installs the undici dispatcher when the optional dep is present", async () => {
    const got = await installProxySupport({ HTTPS_PROXY: "http://127.0.0.1:40183" });
    // undici is an optionalDependency: either it installed, or we must have
    // warned instead. Silently doing neither is the bug this guards.
    expect(["undici-agent", "unconfigured"]).toContain(got.mode);
    if (got.mode === "unconfigured") expect(got.warning).toBeTruthy();
    else expect(got.warning).toBeUndefined();
  });

  it("never leaks proxy credentials into the warning text", async () => {
    const got = await installProxySupport({
      HTTPS_PROXY: "http://user:hunter2@proxy.internal:8080",
    });
    expect(JSON.stringify(got)).not.toContain("hunter2");
  });

  it("honours lowercase https_proxy", async () => {
    const got = await installProxySupport({ https_proxy: "http://127.0.0.1:40183" });
    expect(got.mode).not.toBe("none");
  });
});
