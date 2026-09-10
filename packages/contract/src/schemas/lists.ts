import { z } from "zod";
import { IntId } from "./common.js";

/**
 * Lists & guides endpoints (playlists, short-list, published-list*).
 *
 * `PublishedList` itself IS documented with real fields in
 * openapi/beli.yaml's `components.schemas.PublishedList` and
 * beli-api-reference.md §8 — those are modeled directly. Playlists,
 * short-lists and published-list-items have no field shape captured
 * anywhere in the reference material (only that they come back in a
 * `results` envelope), so their items stay `z.unknown()`.
 */

/** Envelope shared by the "shape unconfirmed" list endpoints below. */
const unknownResultsEnvelope = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();

/**
 * GET /api/playlists/ — playlists available to the user. Item shape not
 * captured (the only playlist-adjacent fields seen anywhere are the
 * `clear_playlists` / `unlocked_playlist_access` counters returned as a
 * *side effect* of process-add-ranking, which are not playlist objects).
 */
export const PlaylistsResponse = unknownResultsEnvelope;

/**
 * GET /api/short-list/{uuid}/ — a user's condensed guide/wishlist. Item
 * shape not captured.
 */
export const ShortListResponse = unknownResultsEnvelope;

/** `challenge_info` sub-object on a PublishedList, per beli.yaml. */
export const PublishedListChallengeInfo = z
  .object({
    is_joined: z.boolean().optional(),
    progress: z.number().optional(),
    total: z.number().optional(),
    participant_count: z.number().int().optional(),
  })
  .passthrough()
  .nullable();
export type PublishedListChallengeInfo = z.infer<
  typeof PublishedListChallengeInfo
>;

/**
 * A published list/guide, per openapi/beli.yaml `components.schemas.PublishedList`
 * and beli-api-reference.md §8. `cover_photo` shape is unconfirmed, kept
 * `unknown`.
 */
export const PublishedList = z
  .object({
    id: IntId,
    title: z.string(),
    description: z.string().nullable().optional(),
    cover_photo: z.unknown().optional(),
    ranked: z.boolean().optional(),
    category: z.string().nullable().optional(),
    quick_link: z.string().nullable().optional(),
    challenge_info: PublishedListChallengeInfo.optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type PublishedList = z.infer<typeof PublishedList>;

/**
 * GET /api/published-list/ and GET /api/published-list/{uuid}/ share the
 * same envelope shape (the latter scopes to one author's published lists).
 */
export const PublishedListResponse = z
  .object({ results: z.array(PublishedList) })
  .passthrough();
export type PublishedListResponse = z.infer<typeof PublishedListResponse>;

/**
 * GET /api/published-list-item-new/ — items on a published list/guide
 * (i.e. the businesses inside a PublishedList). Item shape not captured.
 */
export const PublishedListItemNewResponse = unknownResultsEnvelope;

/**
 * GET /api/published-list-cities/ — cities that have published lists.
 * Item shape not captured (plausibly the same shape as all-cities).
 */
export const PublishedListCitiesResponse = unknownResultsEnvelope;
