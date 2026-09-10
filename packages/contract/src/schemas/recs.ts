import { z } from "zod";
import { IntId } from "./common.js";

/**
 * Recommendation endpoints. `recs` lives on the RECS host and is
 * "external sources only — not in our own HAR captures" per
 * beli-api-reference.md §1/§10; `rec-score` and `user-rec-scores` are on
 * the main API host but have no captured field shapes at all (only the
 * `Allow` header and "request body not captured" notes). All schemas here
 * are intentionally permissive.
 */

/**
 * One entry from GET {RECS}/api/recs/{userId}/, per belimaps-openapi.yaml
 * `RecItem`/`RecList`. Not corroborated by our own captures — treat as
 * unverified. `additionalProperties: true` in the source spec, mirrored
 * here via `.passthrough()`.
 */
export const RecItem = z
  .object({
    business_id: IntId,
    expected_percentile: z.number().optional(),
  })
  .passthrough();
export type RecItem = z.infer<typeof RecItem>;

/**
 * belimaps documents this as a bare array; since it is unverified and the
 * five-shape envelope convention (reference §5) means a `{results:[...]}`
 * wrapper is equally plausible for a real Beli endpoint, accept either.
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
