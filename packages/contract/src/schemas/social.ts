import { z } from "zod";
import { MemberSummary } from "./user.js";

/**
 * Social graph read endpoints beyond follow/unfollow (already covered by
 * `user.ts` + `follow`-adjacent routes elsewhere). `followers`/`following`
 * are corroborated by belimaps-openapi.yaml's `MemberListResponse`, which
 * types them as `{ results: MemberSummary[] }` — modeled directly here.
 *
 * `friends-bookmarked` and `mutual-bookmarks` are ONLY documented as
 * `ResultsEnvelope` (bare `{results: []}` with untyped items) in
 * openapi/beli.yaml — no field list is given for either, so their item
 * shape is left `z.unknown()` rather than assumed to match MemberSummary
 * or Business.
 *
 * Reference §2 flags `/api/followers/` as known to intermittently 503 —
 * that's a transport concern for callers, not a schema one.
 */

/**
 * GET /api/followers/{uuid}/ and GET /api/following/{uuid}/ — per
 * belimaps-openapi.yaml `MemberListResponse`.
 */
export const FollowersResponse = z
  .object({ results: z.array(MemberSummary) })
  .passthrough();
export type FollowersResponse = z.infer<typeof FollowersResponse>;

export const FollowingResponse = FollowersResponse;
export type FollowingResponse = z.infer<typeof FollowingResponse>;

/**
 * GET /api/friends-bookmarked/{uuid}/{id}/ — friends who have bookmarked a
 * business. Item shape not captured anywhere in the reference material.
 */
export const FriendsBookmarkedResponse = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();
export type FriendsBookmarkedResponse = z.infer<
  typeof FriendsBookmarkedResponse
>;

/**
 * GET /api/mutual-bookmarks/{uuid1},{uuid2}/ — businesses bookmarked by
 * both users (note: comma-joined path segment, not two separate segments —
 * beli-api-reference.md §7 / openapi/beli.yaml). Item shape not captured.
 */
export const MutualBookmarksResponse = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();
export type MutualBookmarksResponse = z.infer<typeof MutualBookmarksResponse>;
