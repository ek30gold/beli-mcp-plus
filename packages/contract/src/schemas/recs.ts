import { z } from "zod";

/**
 * Recommendation endpoints. `recs` lives on the RECS host; `rec-score` and
 * `user-rec-scores` are on the main API host. All schemas here are
 * intentionally permissive — see the per-export notes for exactly what is
 * and is not backed by live evidence.
 *
 * EVIDENCE STATUS for `recs` (2026-09-11 live probe, see
 * `@beli/contract`'s `discovered.ts` `RECS_SHAPE.recs`):
 *   CONFIRMED — GET {RECS}/api/recs/{uuid}/ returned HTTP 200 with a
 *     top-level array (24,392 items on the probed account).
 *   CONFIRMED — the item shape. The probe now records each item's key names
 *     and value types (never values), and every one of those 24,392 items
 *     carried exactly `business_id: number` and `expected_percentile: number`,
 *     with no partial keys. See `RECS_ITEM_SHAPE` in discovered.ts.
 *
 * Note on provenance: an earlier draft typed these same two fields from
 * belimaps' third-party OpenAPI capture, and they were removed precisely
 * because that capture is not our own evidence. They are restored here only
 * because a live run independently confirmed them across the full item
 * population — the third-party doc happening to be right does not make it
 * evidence, and it is still not what this schema rests on.
 */

/**
 * One entry from GET {RECS}/api/recs/{uuid}/.
 *
 * Both fields are CONFIRMED live on 100% of items examined (see the evidence
 * note above), so they are required rather than optional. `.passthrough()`
 * keeps any field we have not seen — an item is not narrowed to these two, it
 * is only guaranteed to contain them. Do not add a field here without the
 * same class of evidence: a name appearing in a third-party doc is not enough.
 */
export const RecItem = z
  .object({
    business_id: z.number(),
    expected_percentile: z.number(),
  })
  .passthrough();
export type RecItem = z.infer<typeof RecItem>;

/**
 * CONFIRMED (live): the top-level array. The `{results: [...]}` alternative
 * below is accepted too — Beli's other list endpoints use both envelope
 * conventions, so a caller that gets the wrapped form is not left unable to
 * parse it — but only the bare array has ever actually been observed.
 */
export const RecsResponse = z.union([
  z.array(RecItem),
  z.object({ results: z.array(RecItem) }).passthrough(),
]);
export type RecsResponse = z.infer<typeof RecsResponse>;

/**
 * GET /api/rec-score/ — recommendation score for a business. No field
 * shape captured anywhere in the reference material.
 */
export const RecScoreResponse = z.unknown();

/**
 * POST /api/user-rec-scores/ — compute/refresh recommendation scores for a
 * user. Neither the request body nor the response shape were captured
 * live; per beli-api-reference.md §6 it's grouped with "other observed
 * writes" by presence only (seen in an Allow header / HAR path, not body).
 */
export const UserRecScoresRequest = z.object({}).passthrough();
export const UserRecScoresResponse = z.unknown();
