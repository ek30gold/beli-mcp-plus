import { z } from "zod";
import { IntId, PlaceId, Uuid } from "./common.js";

/**
 * Auth (DRF SimpleJWT). Beli's `POST /api/token/` accepts EITHER an email or a
 * phone-number (E.164) identifier alongside the password — upstream jcjc-dev/
 * beli-mcp only ever sent phone_no. Each shape is `.strict()` so a body cannot
 * mix the two identifiers, and the union enforces "exactly one of email or
 * phone_no, not both, not neither" as a clean zod validation error rather than
 * a runtime crash: a body with both keys fails BOTH branches (the extra key is
 * rejected by strict mode) and a body with neither fails both (the required
 * identifier key is missing).
 * The gateway also requires a browser-like User-Agent + Referer or it 403s.
 */
export const EmailLoginRequest = z
  .object({
    email: z.string().email("expected a valid email address"),
    password: z.string().min(1),
  })
  .strict();
export type EmailLoginRequest = z.infer<typeof EmailLoginRequest>;

export const PhoneLoginRequest = z
  .object({
    phone_no: z.string().regex(/^\+\d{8,15}$/, "expected E.164 phone, e.g. +15551234567"),
    password: z.string().min(1),
  })
  .strict();
export type PhoneLoginRequest = z.infer<typeof PhoneLoginRequest>;

export const LoginRequest = z.union([EmailLoginRequest, PhoneLoginRequest]);
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Access token lives ~20 min; refresh token ~7 days (refresh is NOT rotated). */
export const TokenPair = z.object({
  access: z.string(),
  refresh: z.string(),
});
export type TokenPair = z.infer<typeof TokenPair>;

export const RefreshRequest = z.object({ refresh: z.string() });
export const RefreshResponse = z.object({ access: z.string() });

/** Subset of the logged-in user object returned by /api/user/logged-in/. */
export const LoggedInUser = z.object({
  id: Uuid,
  username: z.string(),
  full_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone_no: z.string().optional(),
  email: z.string().optional().nullable(),
  home_city: z.string().optional().nullable(),
  profile_photo: z.string().optional().nullable(),
});
export type LoggedInUser = z.infer<typeof LoggedInUser>;

export const LoggedInResponse = z.object({
  results: z.array(LoggedInUser).min(1),
});

/** Public-ish profile fields surfaced in member search results. */
export const MemberSummary = z.object({
  id: Uuid,
  full_name: z.string().nullable().optional(),
  username: z.string(),
  instagram_url: z.string().nullable().optional(),
  tiktok_url: z.string().nullable().optional(),
  profile_photo: z.string().nullable().optional(),
});
export type MemberSummary = z.infer<typeof MemberSummary>;

/** Reference linking a business to its Google place id (used widely). */
export const BusinessRef = z.object({ id: IntId, place_id: PlaceId.optional() });
