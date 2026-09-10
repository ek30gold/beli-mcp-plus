import { z } from "zod";
import { Category, IntId, Uuid } from "./common.js";

/**
 * Search & filtering / discovery endpoints (filter-list, filter-configs,
 * filter-options, all-cities, cuisine/all-cuisines).
 *
 * `filter-list` is the only one of these whose request body is directly
 * observed live (beli-api-reference.md §6, corroborated by
 * openapi/beli.yaml `createFilterList`). The others (`filter-configs`,
 * `filter-options`, `all-cities`, `all-cuisines`) have no captured response
 * body anywhere in the reference material beyond "it's an object/array" —
 * their schemas here are deliberately loose (`z.unknown()` / passthrough
 * envelopes) rather than guessed field lists, per the task's schema
 * guidance. Tighten them once a live response is captured.
 */

/** One filter clause: a facet key (e.g. "CITY", "GOODFOR") + string values. */
export const FilterClause = z
  .object({
    key: z.string(),
    value: z.array(z.string()),
  })
  .passthrough();
export type FilterClause = z.infer<typeof FilterClause>;

/**
 * Request body for POST /api/filter-list/ — observed live (H4-deep) per
 * beli-api-reference.md §6. `user2` IS sent even for a single-user query.
 * `bounds` is only ever seen as `null` in captures; `coords`/`ids`/
 * `load_businesses` are present in some calls and absent in others, so all
 * three are optional here.
 */
export const FilterListRequest = z
  .object({
    filters: z.array(FilterClause).default([]),
    list_field: z.string(),
    user: Uuid,
    user2: Uuid.optional(),
    category: Category,
    bounds: z.unknown().nullable().optional(),
    sort_method: z.string(),
    coords: z.string().optional(),
    ids: z.array(IntId).optional(),
    load_businesses: z.boolean().optional(),
  })
  .passthrough();
export type FilterListRequest = z.infer<typeof FilterListRequest>;

/**
 * Response for POST /api/filter-list/. `results` is a plain array of
 * business ids; `businesses` is usually empty unless `load_businesses` was
 * set, in which case its item shape is unconfirmed here, so it stays
 * `unknown[]`. `business_hash` is an id-keyed lookup object of unconfirmed
 * shape.
 */
export const FilterListResponse = z
  .object({
    results: z.array(IntId),
    count: z.number().int().optional(),
    businesses: z.array(z.unknown()).optional(),
    business_hash: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type FilterListResponse = z.infer<typeof FilterListResponse>;

/**
 * GET /api/filter-configs/ — available search/filter facet configuration.
 * No field shape captured anywhere in the reference material; response is
 * described only as "an object" in openapi/beli.yaml. Left fully unknown.
 */
export const FilterConfigsResponse = z.unknown();

/**
 * POST /api/filter-options/ — filter option values for the discovery query
 * builder. Both request and response bodies are uncaptured
 * ("body shape not fully captured" per openapi/beli.yaml); request is
 * treated as an arbitrary JSON object.
 */
export const FilterOptionsRequest = z.object({}).passthrough();
export const FilterOptionsResponse = z.unknown();

/**
 * GET /api/all-cities/ — every city Beli operates in, returned whole (no
 * pagination observed; ~390 KB per reference §5). Item shape not captured
 * beyond being present in a `results` envelope.
 */
export const AllCitiesResponse = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();
export type AllCitiesResponse = z.infer<typeof AllCitiesResponse>;

/**
 * GET /api/cuisine/all-cuisines/ — every cuisine tag known to the system.
 * Item shape not captured beyond being present in a `results` envelope.
 */
export const AllCuisinesResponse = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();
export type AllCuisinesResponse = z.infer<typeof AllCuisinesResponse>;
