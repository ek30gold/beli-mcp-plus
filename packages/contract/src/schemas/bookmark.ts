import { z } from "zod";
import { Business } from "./business.js";
import { Category, IntId, Uuid } from "./common.js";

/**
 * Add a place to "Want to Try". POST /api/add-bookmark/ -> 200 (empty body).
 * Verified live: ids-only payload works (the app also sends the full business
 * object, but it is optional). `source_id` = the user who suggested it (null = self).
 */
export const AddBookmarkRequest = z
  .object({
    user_id: Uuid,
    business_id: IntId,
    category: Category,
    source_id: Uuid.nullable().default(null),
    res_notifs_enabled: z.boolean().default(false),
    display: z.boolean().default(true),
    /** JS `Date.toString()`-style timestamp the app sends. */
    start_dt: z.string(),
  })
  .passthrough();
export type AddBookmarkRequest = z.infer<typeof AddBookmarkRequest>;

/**
 * Remove a bookmark. PUT /api/remove-bookmark/?supports_guide_item_cleanup=true
 * (same body as add) -> 200 { guide_items_removed }.
 */
export const RemoveBookmarkRequest = z
  .object({
    user_id: Uuid,
    business_id: IntId,
    category: Category,
    display: z.boolean().default(true),
  })
  .passthrough();
export type RemoveBookmarkRequest = z.infer<typeof RemoveBookmarkRequest>;

export const RemoveBookmarkResponse = z
  .object({ guide_items_removed: z.boolean().optional() })
  .passthrough();

/** A row in GET /api/get-bookmark/?user=&category= ("Want to Try"). */
export const BookmarkListItem = z
  .object({
    id: IntId,
    user: Uuid,
    business: Business,
  })
  .passthrough();

/**
 * get-bookmark returns category-keyed arrays, e.g. `{ "Restaurants": [...] }`.
 *
 * Parsed leniently at the TOP level only. A strict
 * `z.record(z.string(), z.array(...))` rejects the whole response the moment
 * the API adds a single scalar sibling key (a `count`, a `next`), which would
 * take out the Want-to-Try list entirely — this was the one schema in the
 * contract that could not absorb an additive change, while everything else
 * uses `.passthrough()` for exactly that reason.
 *
 * So: non-array values are treated as metadata and skipped, while any value
 * that IS an array is still parsed strictly. Tolerating a new sibling key is
 * not the same as tolerating a changed row shape, and a real change to the
 * rows should still fail loudly rather than silently yield an empty list.
 */
export const BookmarkListResponse = z
  .record(z.string(), z.unknown())
  .transform((raw, ctx) => {
    const out: Record<string, BookmarkListItem[]> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!Array.isArray(value)) continue; // additive metadata key, not a bucket
      const parsed = z.array(BookmarkListItem).safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `bookmark bucket "${key}" did not match the expected row shape`,
        });
        continue;
      }
      out[key] = parsed.data;
    }
    return out;
  });
export type BookmarkListItem = z.infer<typeof BookmarkListItem>;
