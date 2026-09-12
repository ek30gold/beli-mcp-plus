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
 * (`BAKERY`, `DESSERT`, `COFFEE`, `OTHER`).
 *
 * RESOLVED (2026-09-11, second live pass). The long forms are NOT valid.
 *
 * GET /api/get-ranking/ accepts all eight without error, which made the
 * question look unanswerable: the four long forms returned HTTP 200 with zero
 * rows, indistinguishable from a value the endpoint silently ignores.
 * GET /api/get-bookmark/ settles it. It answers HTTP 500 for `BAKERY`,
 * `DESSERT`, `COFFEE` and `OTHER`, and returns real data for `RES`, `BAR`,
 * `BAK` and `DES`. One endpoint ignoring a bad value while another rejects it
 * is the tell: get-bookmark is the reliable oracle for whether a category code
 * is real, and get-ranking is not.
 *
 * So the confirmed codes are the four three-letter ones, and the enum is kept
 * over-inclusive only to avoid breaking a caller that still passes a long form.
 * Prefer `CATEGORIES_CONFIRMED` below.
 *
 * INCOMPLETE, though: the app offers FIVE categories (Restaurants, Bars,
 * Bakeries, Coffee & Tea, Ice Cream & Dessert). Coffee & Tea is real and its
 * code is UNKNOWN — `COFFEE` is not it. Every confirmed code is three letters,
 * so `COF`, `CAF` or `TEA` are plausible, but none has been tested and a guess
 * here would silently return the wrong list. Until it is confirmed, any
 * aggregate over these four categories is KNOWN to be short by whatever is
 * filed under Coffee & Tea (31 Been and 4 Want-to-Try on the probed account).
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
 * The category codes confirmed valid by GET /api/get-bookmark/ (which rejects
 * an invalid code with a 500 rather than silently ignoring it).
 *
 * Deliberately NOT the full `Category` enum: these are the four that are known
 * to work. This list is also known INCOMPLETE — the app's Coffee & Tea
 * category has no confirmed code yet. Anything aggregating over it should say
 * so rather than present the total as complete.
 */
export const CATEGORIES_CONFIRMED = ["RES", "BAR", "BAK", "DES"] as const;
export type ConfirmedCategory = (typeof CATEGORIES_CONFIRMED)[number];

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
