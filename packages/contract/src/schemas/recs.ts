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
 *     top-level array (24,392 items on the probed account). That is the
 *     ENTIRE confirmed shape.
 *   UNCONFIRMED — the internal shape of one item. Nothing was captured
 *     (live or otherwise) about what fields an item carries, so none are
 *     asserted here. A prior draft of this schema modeled items after
 *     belimaps' third-party OpenAPI capture (`business_id`,
 *     `expected_percentile`) — that capture is not our own evidence, and
 *     typing against it would let an assumption masquerade as a confirmed
 *     field. Treat every item as opaque until a live capture says otherwise.
 */

/**
 * One entry from GET {RECS}/api/recs/{uuid}/. Intentionally untyped: no
 * item-level field was confirmed live. Consumers get the raw item back
 * unmodified — do not add typed fields here without new live evidence.
 */
export const RecItem = z.unknown();
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
