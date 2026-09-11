import { describe, expect, it } from "vitest";
import { AppContext } from "../context.js";
import { registerRecsTools } from "../tools/recs.js";

/** Minimal McpServer stand-in that captures what a registrar registers. */
function captureServer() {
  const tools = new Map<string, { config: any; handler: (a: any) => Promise<any> }>();
  return {
    server: {
      registerTool(name: string, config: any, handler: (a: any) => Promise<any>) {
        tools.set(name, { config, handler });
      },
    } as any,
    tools,
  };
}

/** AppContext with a stubbed client; no network, no credentials. */
function ctxWith(client: Partial<{ getRecs: (...a: any[]) => Promise<unknown> }>) {
  return new AppContext(
    client as any,
    {} as any,
    { minIntervalMs: 0, allowWrites: false } as any,
  );
}

describe("get_recs tool", () => {
  it("is registered read-only", () => {
    const { server, tools } = captureServer();
    registerRecsTools(server, ctxWith({ getRecs: async () => [] }));
    const tool = tools.get("get_recs");
    expect(tool).toBeDefined();
    expect(tool!.config.annotations.readOnlyHint).toBe(true);
  });

  it("returns the confirmed bare-array envelope with items passed through untyped", async () => {
    const recsItems = [
      { business_id: 7316, expected_percentile: 0.92 },
      { shape: "unconfirmed — anything could be here" },
    ];
    const { server, tools } = captureServer();
    registerRecsTools(server, ctxWith({ getRecs: async () => recsItems }));

    const res = await tools.get("get_recs")!.handler({});
    const payload = JSON.parse(res.content[0].text);

    expect(payload.count).toBe(2);
    expect(payload.itemShapeConfirmed).toBe(false);
    // Items must round-trip exactly — the tool must never narrow, rename or
    // drop fields it hasn't confirmed exist.
    expect(payload.items).toEqual(recsItems);
  });

  it("unwraps the legacy {results:[...]} envelope (accepted but never observed live)", async () => {
    const { server, tools } = captureServer();
    registerRecsTools(server, ctxWith({ getRecs: async () => ({ results: [{ x: 1 }] }) }));

    const res = await tools.get("get_recs")!.handler({});
    const payload = JSON.parse(res.content[0].text);
    expect(payload.count).toBe(1);
    expect(payload.items).toEqual([{ x: 1 }]);
  });

  it("forwards an explicit userId to the client", async () => {
    let seen: unknown;
    const { server, tools } = captureServer();
    registerRecsTools(
      server,
      ctxWith({
        getRecs: async (userId?: string) => {
          seen = userId;
          return [];
        },
      }),
    );
    const uuid = "11111111-2222-3333-4444-555555555555";
    await tools.get("get_recs")!.handler({ userId: uuid });
    expect(seen).toBe(uuid);
  });

  it("omits userId when not provided", async () => {
    let seen = "unset";
    const { server, tools } = captureServer();
    registerRecsTools(
      server,
      ctxWith({
        getRecs: async (userId?: string) => {
          seen = String(userId);
          return [];
        },
      }),
    );
    await tools.get("get_recs")!.handler({});
    expect(seen).toBe("undefined");
  });

  it("surfaces a client error as a structured tool error, not a throw", async () => {
    const { server, tools } = captureServer();
    registerRecsTools(
      server,
      ctxWith({
        getRecs: async () => {
          throw new Error("session expired or missing");
        },
      }),
    );
    const res = await tools.get("get_recs")!.handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("login");
  });
});
