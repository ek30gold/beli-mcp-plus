/**
 * An in-memory stand-in for Beli's API, good enough to drive the real probe
 * end-to-end through a stubbed global `fetch`.
 *
 * The point is to give the discovery logic a world whose GROUND TRUTH we
 * control, so we can assert that it reaches the right conclusion — and, more
 * importantly, that it refuses to reach a confident wrong one. The live probe
 * gets exactly one shot at classifying `list_field`; a bug there produces a
 * confidently wrong answer that every downstream list tool inherits.
 */

const USER_ID = "11111111-2222-3333-4444-555555555555";

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const accessToken = (userId: string) =>
  `h.${b64u({ exp: Math.floor(Date.now() / 1000) + 1200, user_id: userId })}.s`;

export interface FakeBeliOptions {
  /** Business ids in the account's Been list (GET /api/get-ranking/). */
  beenIds: number[];
  /** Business ids in the account's Want-to-Try list (GET /api/get-bookmark/). */
  wantToTryIds: number[];
  /**
   * Ground truth for POST /api/filter-list/: which ids each `list_field` value
   * returns. Any value not present here is rejected the way an unknown enum
   * value plausibly would be.
   */
  filterList: Record<string, number[]>;
  /** Force GET /api/get-ranking/ to fail, to test reference-fetch degradation. */
  failGetRanking?: boolean;
  /** Force GET /api/get-bookmark/ to fail. */
  failGetBookmark?: boolean;
  /** Categories GET /api/get-ranking/ accepts; others 400. */
  acceptedCategories?: string[];
  /** Body returned by GET /api/filter-configs/. */
  filterConfigs?: unknown;
  /**
   * Items GET /api/recs/{userId}/ returns, as the confirmed live envelope
   * (a bare top-level array — see RECS_SHAPE.recs in @beli/contract's
   * discovered.ts). Defaults to the pre-existing `{results: []}` stub when
   * omitted, so tests that don't care about recs are unaffected.
   */
  recsItems?: unknown[];
  userId?: string;
}

export interface FakeBeli {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  userId: string;
  /** Every list_field value the probe actually asked about. */
  listFieldsTried: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function makeFakeBeli(opts: FakeBeliOptions): FakeBeli {
  const userId = opts.userId ?? USER_ID;
  const accepted = opts.acceptedCategories ?? ["RES", "BAR", "COFFEE", "OTHER"];
  const listFieldsTried: string[] = [];

  const rankingRows = (ids: number[]) =>
    ids.map((id, i) => ({
      id: 1000 + i,
      user: userId,
      business: { id, name: `Been Place ${id}`, city: "New York" },
      score: 9 - i * 0.1,
    }));

  const bookmarkRows = (ids: number[]) =>
    ids.map((id, i) => ({
      id: 2000 + i,
      user: userId,
      business: { id, name: `Want Place ${id}`, city: "New York" },
    }));

  const fetchImpl = async (rawUrl: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(rawUrl);
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    // Host reachability pings.
    if (path === "/" || path === "") return json({ ok: true });

    if (path === "/api/token/" && method === "POST") {
      return json({ access: accessToken(userId), refresh: "refresh-token-value" });
    }
    if (path === "/api/token/refresh/" && method === "POST") {
      return json({ access: accessToken(userId) });
    }
    if (path === "/api/user/logged-in/") {
      return json({ id: userId, username: "tester" });
    }

    if (path === "/api/get-ranking/") {
      if (opts.failGetRanking) return json({ detail: "Server error" }, 500);
      const category = url.searchParams.get("category") ?? "RES";
      if (!accepted.includes(category)) {
        return json({ detail: `Invalid category ${category}` }, 400);
      }
      // Only the RES bucket carries the fixture rows; other accepted
      // categories are legitimately empty for this account.
      return json({ results: category === "RES" ? rankingRows(opts.beenIds) : [] });
    }

    if (path === "/api/get-bookmark/") {
      if (opts.failGetBookmark) return json({ detail: "Server error" }, 500);
      return json({ Restaurants: bookmarkRows(opts.wantToTryIds) });
    }

    if (path === "/api/filter-list/" && method === "POST") {
      const field = String(body?.list_field ?? "");
      listFieldsTried.push(field);
      const ids = opts.filterList[field];
      if (!ids) return json({ detail: `Invalid list_field: ${field}` }, 400);
      return json({ results: ids, count: ids.length });
    }

    if (path === "/api/filter-configs/") {
      return json(opts.filterConfigs ?? { facets: [] });
    }
    if (path === "/api/filter-options/" && method === "POST") {
      return json({ options: [] });
    }

    // Recs endpoint — bare top-level array is the only confirmed live
    // shape; callers that care supply items via `recsItems`, otherwise this
    // keeps returning the pre-existing empty-envelope stub unchanged.
    if (path.startsWith("/api/recs/")) {
      return json(opts.recsItems !== undefined ? opts.recsItems : { results: [] });
    }
    if (path.startsWith("/api/rec-score/")) return json({ results: [] });

    return json({ detail: `Unhandled ${method} ${path}` }, 404);
  };

  return { fetch: fetchImpl, userId, listFieldsTried };
}
