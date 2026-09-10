import { describe, expect, it } from "vitest";
import type { Business } from "@beli/contract";
import { AppContext } from "../context.js";
import { registerListSearchTools } from "../tools/lists.js";

const biz = (id: number, name: string, over: Partial<Business> = {}): Business =>
  ({ id, name, ...over }) as Business;

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
function ctxWith(client: Partial<{ searchList: (...a: any[]) => Promise<unknown> }>) {
  return new AppContext(
    client as any,
    {} as any,
    { minIntervalMs: 0, allowWrites: false } as any,
  );
}

describe("search_list tool", () => {
  it("is registered as a read-only tool", () => {
    const { server, tools } = captureServer();
    registerListSearchTools(server, ctxWith({ searchList: async () => [] }));
    const tool = tools.get("search_list");
    expect(tool).toBeDefined();
    expect(tool!.config.annotations.readOnlyHint).toBe(true);
  });

  it("passes the filter through to the client and reports the result count", async () => {
    let seen: any[] = [];
    const { server, tools } = captureServer();
    registerListSearchTools(
      server,
      ctxWith({
        searchList: async (...args: any[]) => {
          seen = args;
          return [{ id: 1, business: biz(10, "Joe's Pizza"), score: 8.1 }];
        },
      }),
    );

    const res = await tools.get("search_list")!.handler({
      list: "been",
      category: "RES",
      query: "pizza",
      minScore: 8,
      sort: "score_desc",
      limit: 50,
      offset: 0,
    });

    const [list, category, filter, userId] = seen;
    expect(list).toBe("been");
    expect(category).toBe("RES");
    expect(filter).toMatchObject({ query: "pizza", minScore: 8, limit: 50 });
    // list/category/userId are separate arguments, not part of the filter.
    expect(filter).not.toHaveProperty("list");
    expect(filter).not.toHaveProperty("category");
    expect(userId).toBeUndefined();

    const payload = JSON.parse(res.content[0].text);
    expect(payload.count).toBe(1);
    // The caller must never mistake these for server-side filtered results.
    expect(payload.filteredBy).toContain("client-side");
  });

  it("forwards an explicit userId", async () => {
    let seen: any[] = [];
    const { server, tools } = captureServer();
    registerListSearchTools(
      server,
      ctxWith({
        searchList: async (...args: any[]) => {
          seen = args;
          return [];
        },
      }),
    );
    const uuid = "11111111-2222-3333-4444-555555555555";
    await tools.get("search_list")!.handler({
      list: "want_to_try", category: "BAR", userId: uuid, limit: 50, offset: 0, sort: "score_desc",
    });
    expect(seen[3]).toBe(uuid);
  });

  it("surfaces a client error as a structured tool error, not a throw", async () => {
    const { server, tools } = captureServer();
    registerListSearchTools(
      server,
      ctxWith({
        searchList: async () => {
          throw new Error("session expired or missing");
        },
      }),
    );
    const res = await tools.get("search_list")!.handler({
      list: "been", category: "RES", limit: 50, offset: 0, sort: "score_desc",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("login");
  });
});
