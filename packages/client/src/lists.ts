import type { Business } from "@beli/contract";

/**
 * Client-side search and filtering over a user's personal lists.
 *
 * WHY THIS IS CLIENT-SIDE
 * -----------------------
 * Beli's own `POST /api/filter-list/` takes a `list_field` parameter that
 * selects which list to filter server-side. As of 2026-09-10 nobody has
 * established what `list_field` values select Been, Want to Try or Recs — the
 * discovery run that was meant to settle it never reached the API (see
 * docs/api-discovery.md). Rather than block the feature on that unknown, the
 * filtering here runs over the rows the already-proven endpoints return:
 * `GET /api/get-ranking/` for Been and `GET /api/get-bookmark/` for Want to Try.
 *
 * This is a deliberate trade, not a conclusion that `filter-list` cannot work:
 *   - it fetches a whole category's list and filters in process, so it does
 *     more network work than a server-side filter would, and
 *   - it can only filter on fields those endpoints actually return.
 * When `list_field` is established, a server-side backend can be added behind
 * the same {@link ListFilter} shape and chosen at runtime. Nothing here assumes
 * `filter-list` is unusable.
 *
 * Everything in this module is pure: it takes rows and returns rows, so it is
 * testable without a network and without an account.
 */

/** Which personal list to read. */
export type ListName = "been" | "want_to_try";

/** How to order results. Ties always break on name so paging is stable. */
export type ListSort = "score_desc" | "score_asc" | "name_asc" | "name_desc";

/**
 * One normalised row from either list. `get-ranking` returns a flat
 * `{results: [...]}` while `get-bookmark` returns category-keyed buckets; both
 * collapse to this.
 */
export interface ListEntry {
  /** The ranking or bookmark row id (NOT the business id). */
  id: number;
  business: Business;
  /**
   * The 0–10 Beli score. Present on Been rows; `null`/absent on Want to Try,
   * which has no score by definition.
   */
  score?: number | null;
  /** For Want to Try, the category bucket key the API grouped the row under. */
  bucket?: string;
}

export interface ListFilter {
  /** Case-insensitive substring over name, cuisines, neighborhood and city. */
  query?: string;
  city?: string;
  neighborhood?: string;
  /** Matches if ANY of the place's cuisines contains this substring. */
  cuisine?: string;
  /** Beli price tier, typically 1–4. Inclusive bounds. */
  minPrice?: number;
  maxPrice?: number;
  /** 0–10 score bounds. Inclusive. Been rows only — see filterListEntries. */
  minScore?: number;
  maxScore?: number;
  sort?: ListSort;
  /** Max rows to return after filtering and sorting. */
  limit?: number;
  /** Rows to skip before applying `limit`. */
  offset?: number;
}

/** Lowercase + collapse whitespace, so " Le  Bernardin " matches "le bernardin". */
function norm(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase().replace(/\s+/g, " ").trim() : "";
}

function includes(haystack: unknown, needle: string): boolean {
  return norm(haystack).includes(needle);
}

/**
 * Flatten `GET /api/get-ranking/`'s `{results: [...]}` into {@link ListEntry}s.
 */
export function normalizeBeen(
  response: { results: Array<{ id: number; business: Business; score?: number | null }> },
): ListEntry[] {
  return response.results.map((r) => ({ id: r.id, business: r.business, score: r.score ?? null }));
}

/**
 * Flatten `GET /api/get-bookmark/`'s category-keyed buckets — e.g.
 * `{"Restaurants": [...], "Bars": [...]}` — into a single list, recording which
 * bucket each row came from.
 */
export function normalizeWantToTry(
  response: Record<string, Array<{ id: number; business: Business }>>,
): ListEntry[] {
  const out: ListEntry[] = [];
  for (const [bucket, rows] of Object.entries(response)) {
    if (!Array.isArray(rows)) continue; // tolerate non-array metadata keys
    for (const r of rows) out.push({ id: r.id, business: r.business, bucket });
  }
  return out;
}

/**
 * Apply a filter to normalised rows. Pure — no network, no ordering surprises.
 *
 * A note on missing data: a row whose `price` or `score` is null/absent is
 * EXCLUDED when a bound on that field is set. The row cannot be shown to
 * satisfy the constraint, and silently keeping it would misreport an unscored
 * place as meeting a score floor. Want-to-Try rows have no score at all, so any
 * score bound empties that list rather than pretending otherwise.
 */
export function filterListEntries(entries: ListEntry[], filter: ListFilter = {}): ListEntry[] {
  const q = norm(filter.query);
  const city = norm(filter.city);
  const neighborhood = norm(filter.neighborhood);
  const cuisine = norm(filter.cuisine);

  let out = entries.filter((e) => {
    const b = e.business;

    if (q) {
      const hit =
        includes(b.name, q) ||
        includes(b.city, q) ||
        includes(b.neighborhood, q) ||
        includes(b.borough, q) ||
        (b.cuisines ?? []).some((c) => includes(c, q));
      if (!hit) return false;
    }
    if (city && !includes(b.city, city) && !includes(b.borough, city)) return false;
    if (neighborhood && !includes(b.neighborhood, neighborhood)) return false;
    if (cuisine && !(b.cuisines ?? []).some((c) => includes(c, cuisine))) return false;

    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      if (typeof b.price !== "number") return false;
      if (filter.minPrice !== undefined && b.price < filter.minPrice) return false;
      if (filter.maxPrice !== undefined && b.price > filter.maxPrice) return false;
    }

    if (filter.minScore !== undefined || filter.maxScore !== undefined) {
      if (typeof e.score !== "number") return false;
      if (filter.minScore !== undefined && e.score < filter.minScore) return false;
      if (filter.maxScore !== undefined && e.score > filter.maxScore) return false;
    }

    return true;
  });

  out = sortListEntries(out, filter.sort);

  const offset = Math.max(0, filter.offset ?? 0);
  const end = filter.limit !== undefined ? offset + Math.max(0, filter.limit) : undefined;
  return out.slice(offset, end);
}

/**
 * Sort rows. Unscored rows always sink to the bottom of a score sort rather
 * than being treated as zero, and name is the tiebreaker everywhere so that
 * paging over an unchanged list is deterministic.
 */
export function sortListEntries(entries: ListEntry[], sort: ListSort = "score_desc"): ListEntry[] {
  const byName = (a: ListEntry, b: ListEntry) => norm(a.business.name).localeCompare(norm(b.business.name));
  const copy = [...entries];

  switch (sort) {
    case "name_asc":
      return copy.sort(byName);
    case "name_desc":
      return copy.sort((a, b) => byName(b, a));
    case "score_asc":
    case "score_desc": {
      const dir = sort === "score_asc" ? 1 : -1;
      return copy.sort((a, b) => {
        const as = typeof a.score === "number" ? a.score : null;
        const bs = typeof b.score === "number" ? b.score : null;
        if (as === null && bs === null) return byName(a, b);
        if (as === null) return 1; // unscored sinks regardless of direction
        if (bs === null) return -1;
        if (as === bs) return byName(a, b);
        return (as - bs) * dir;
      });
    }
    default:
      return copy;
  }
}
