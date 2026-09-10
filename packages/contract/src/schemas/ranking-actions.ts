import { z } from "zod";

/**
 * PUT /api/delete-ranking/{uuid}/{id}/ — soft-delete a rating/review.
 * Verified live (beli-api-reference.md §6, H5-rate): sent with an empty
 * JSON body, returns `{ guide_items_removed: bool }`. This is the second
 * half of the self-reverting add-ranking -> delete-ranking flow.
 */
export const DeleteRankingRequest = z.object({}).passthrough();
export type DeleteRankingRequest = z.infer<typeof DeleteRankingRequest>;

export const DeleteRankingResponse = z
  .object({ guide_items_removed: z.boolean().optional() })
  .passthrough();
export type DeleteRankingResponse = z.infer<typeof DeleteRankingResponse>;
