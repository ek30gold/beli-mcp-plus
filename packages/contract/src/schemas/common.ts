import { z } from "zod";

/**
 * Primitive, reusable schemas shared across the Beli contract.
 * All shapes here were confirmed against live traffic from app v9.3.1.
 */

/** Beli user / resource identifier (UUID v4). */
export const Uuid = z.string().uuid();

/** Internal integer primary key for a business/photo/ranking/etc. */
export const IntId = z.number().int();

/** Google Places identifier — Beli keys every business to one of these. */
export const PlaceId = z.string().min(1);

/**
 * List/category code (UPPERCASE enum used by add-ranking, bookmarks, lists,
 * and the discovery/filter endpoints). `RES` (restaurants) is the default.
 *
 * This is the UNION of every code observed across both reference projects:
 * the 3-letter short codes from beli-api-reference.md §4 (`RES`, `BAR`,
 * `BAK`, `DES`) plus the longer codes belimaps' OpenAPI capture uses
 * (`BAKERY`, `DESSERT`, `COFFEE`, `OTHER`). It is NOT confirmed whether the
 * live API accepts the short and long forms interchangeably (e.g. `BAK` vs.
 * `BAKERY`) for every category, or whether one form is stale — the exact
 * live set is resolved later by the discovery node (T5). Treat this enum as
 * intentionally over-inclusive until then.
 */
export const Category = z.enum([
  "RES",
  "BAR",
  "BAK",
  "BAKERY",
  "DES",
  "DESSERT",
  "COFFEE",
  "OTHER",
]);
export type Category = z.infer<typeof Category>;

/**
 * Human-facing sentiment bucket shown in the rank sheet, mapped to the numeric
 * seed `value` sent to the ranker (the displayed 0–10 score is computed
 * server-side via pairwise comparison). green=liked, yellow=fine, red=disliked.
 * Confirmed live: "liked" -> 2.5.
 */
export const Sentiment = z.enum(["liked", "fine", "disliked"]);
export type Sentiment = z.infer<typeof Sentiment>;

export const SENTIMENT_VALUE: Record<z.infer<typeof Sentiment>, number> = {
  liked: 2.5,
  fine: 1.5,
  disliked: 0.5,
};

/** Visit date as `YYYY-MM-DD`. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** ISO-8601 datetime string (e.g. created_dt). */
export const IsoDateTime = z.string();

/** DRF-style paginated envelope: { count, next, previous, results: T[] }. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    count: z.number().int().optional(),
    next: z.string().nullable().optional(),
    previous: z.string().nullable().optional(),
    results: z.array(item),
  });
