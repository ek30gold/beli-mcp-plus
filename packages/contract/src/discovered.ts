/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by `beli-mcp-plus probe --emit-discovered` from a live run against
 * the Beli API. Re-run the probe to regenerate; hand edits are overwritten.
 *
 * Generated:   2026-09-11T07:54:41.494Z
 * Account:     902c99ec-31bb-4c2b-bb65-2bd8c6848b91
 * App version: 9.3.1
 * Authenticated: yes
 *
 * CONFIRMED  = direct evidence in the probe report (quoted per value).
 * ASSUMED    = best guess, unverified.
 * UNRESOLVED = the probe could not establish this. Do NOT substitute a guess:
 *              a wrong list_field silently returns the wrong list.
 */

/** Reference id counts the list_field overlap evidence was measured against. */
export const DISCOVERY_REFERENCE = {
  beenIdCount: 388,
  wantToTryIdCount: 568,
} as const;

/**
 * `list_field` values for POST /api/filter-list/.
 *
 * BEEN:        CONFIRMED — 388/388 returned ids appear in get-ranking -> BEEN list
 * WANT_TO_TRY: CONFIRMED — 568/568 returned ids appear in get-bookmark -> WANT_TO_TRY list
 * RECS:        UNRESOLVED — no candidate concluded RECS
 */
export const LIST_FIELD = {
  BEEN: "RANK",
  WANT_TO_TRY: "BOOKMARKED",
  RECS: null,
} as const;

/** True only when filter-list can actually serve BOTH personal lists. */
export const FILTER_LIST_SERVES_PERSONAL_LISTS = true;

/**
 * Category values GET /api/get-ranking/ accepted live.
 * CONFIRMED — accepted: [RES, BAR, BAK, BAKERY, DES, DESSERT, COFFEE, OTHER]; rejected: [none]
 */
export const CATEGORIES = ["RES", "BAR", "BAK", "BAKERY", "DES", "DESSERT", "COFFEE", "OTHER"] as const;

/**
 * Facet keys seen in /api/filter-configs/ and /api/filter-options/.
 * CONFIRMED — observed live
 */
export const FACET_KEYS = ["CITY", "GOODFOR", "SCORE", "NUMFRIENDS", "CUISINE", "PRICECODE", "BOROUGH", "NEIGHBORHOOD", "COUNTRY"] as const;

/**
 * Shape of the recs endpoints.
 * GET {RECS}/api/recs/{uuid}/ -> curated-list
 * GET /api/rec-score/         -> not-run
 * CONFIRMED — observed live
 */
export const RECS_SHAPE = {
  recs: "curated-list",
  recScore: "not-run",
} as const;
