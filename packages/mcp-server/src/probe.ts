/**
 * `beli-mcp-plus probe` / `beli_doctor` — shared diagnostics implementation.
 *
 * Purpose: resolve the two things nobody has documented about Beli's private
 * API — the `category` enum accepted by /api/get-ranking/, and (the critical
 * unknown) what `list_field` value POST /api/filter-list/ needs to select
 * the Been / Want-to-Try / Recs lists. Every step below is independently
 * wrapped so one dead endpoint can never abort the run — the whole point of
 * a probe is to survive a mostly-broken environment and still report what it
 * found.
 *
 * Evidence standard for `list_field` (per the owning task): id-overlap with
 * the known Been (`get-ranking`) and Want-to-Try (`get-bookmark`) lists, not
 * name plausibility. A candidate named "BEEN" whose ids overlap the bookmark
 * list is a Want-to-Try field, and this module reports it that way.
 */
import {
  BeliApiError,
  installProxySupport,
  type BeliClient,
  type ProxyStatus,
} from "@beli/client";
import { Category, HOSTS, META, type HostKey } from "@beli/contract";
import type { Config } from "./config.js";

type CategoryValue = (typeof Category.options)[number];

// ---------------------------------------------------------------------------
// Shared small helpers
// ---------------------------------------------------------------------------

/** Redact a token/secret-looking string to a short, non-sensitive prefix. */
export function redact(value: string | null | undefined, keep = 10): string {
  if (!value) return "(none)";
  return value.length <= keep ? value : `${value.slice(0, keep)}…`;
}

function errInfo(err: unknown): { status: number | null; message: string } {
  if (err instanceof BeliApiError) {
    return { status: err.status, message: err.message.slice(0, 400) };
  }
  // A proxy refusing the CONNECT tunnel surfaces here as a bare "fetch failed",
  // which sends the reader hunting for a credential or network problem that
  // does not exist. Name the real cause wherever an error is rendered.
  const block = detectEgressBlockFromError(err);
  if (block) {
    return {
      status: null,
      message: `blocked by network egress policy (${block}) — the host is not in this environment's allowed domains`,
    };
  }
  if (err instanceof Error) return { status: null, message: err.message.slice(0, 400) };
  return { status: null, message: String(err).slice(0, 400) };
}

/** Politeness throttle, matching AppContext's — used when the caller (CLI) has no AppContext. */
export function makeThrottle(minIntervalMs: number): () => Promise<void> {
  let last = 0;
  return async () => {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface HostReachability {
  host: HostKey;
  url: string;
  reachable: boolean;
  status: number | null;
  ms: number;
  error?: string;
  /**
   * True when the response came from an egress proxy refusing the host rather
   * than from Beli. Sandboxed environments (Claude Code cloud sessions, CI
   * runners behind a default-deny proxy) answer non-allowlisted hosts with
   * their own 403, which would otherwise read as a successful round-trip and
   * hide a misconfigured allowlist behind a cascade of confusing auth errors.
   */
  blockedByEgress?: boolean;
}

export interface SessionProbe {
  refreshTokenPresent: boolean;
  refreshTokenPreview: string;
  refreshTokenValid: boolean | null; // null = not tested (no refresh token to test)
  refreshError?: string;
  credentialsAvailable: boolean;
  credentialIdentifierType: "email" | "phone" | "none";
  loginAttempted: boolean;
  loginSucceeded: boolean | null;
  loginError?: string;
  accessTokenPreview: string;
  authenticated: boolean;
  userId: string | null;
}

export interface CategoryProbeResult {
  category: string;
  ok: boolean;
  status: number | null;
  resultCount: number | null;
  error?: string;
}

export interface Overlap {
  matched: number;
  total: number;
}

export interface ListFieldCandidateResult {
  candidate: string;
  source: "static" | "filter-configs";
  ok: boolean;
  status: number | null;
  count: number | null;
  sampleIds: number[];
  error?: string;
  overlapBeen: Overlap | null;
  overlapWantToTry: Overlap | null;
  conclusion: string;
}

export interface ListFieldProbe {
  skipped: boolean;
  skipReason?: string;
  requestTemplate?: Record<string, unknown>;
  beenIdCount: number | null;
  wantToTryIdCount: number | null;
  candidates: ListFieldCandidateResult[];
  bestBeenCandidate: string | null;
  bestWantToTryCandidate: string | null;
  unresolvedCandidates: string[];
}

export interface FacetProbe {
  skipped: boolean;
  skipReason?: string;
  filterConfigs: { ok: boolean; status: number | null; error?: string; topLevelKeys: string[]; facetKeys: string[] };
  filterOptions: { ok: boolean; status: number | null; error?: string; topLevelKeys: string[]; facetKeys: string[] };
}

export interface RecsProbe {
  skipped: boolean;
  skipReason?: string;
  recs: { ok: boolean; status: number | null; error?: string; shape: RecsShape; itemCount: number | null };
  recScore: { ok: boolean; status: number | null; error?: string; shape: RecsShape };
}

export type RecsShape = "curated-list" | "score-map" | "empty" | "unknown" | "not-run";

export interface ProbeReport {
  generatedAt: string;
  appVersion: string;
  /**
   * How this process is routing outbound HTTPS. Recorded because a proxy that
   * is configured but unused turns every host into a spurious "unreachable",
   * and the report is the first place anyone looks when that happens.
   */
  proxy: ProxyStatus;
  hosts: HostReachability[];
  session: SessionProbe;
  categories: {
    skipped: boolean;
    skipReason?: string;
    candidatesTried: string[];
    results: CategoryProbeResult[];
    accepted: string[];
  };
  listField: ListFieldProbe;
  facets: FacetProbe;
  recs: RecsProbe;
}

// ---------------------------------------------------------------------------
// Candidate lists
// ---------------------------------------------------------------------------

/** GET /api/get-ranking/ category candidates — the full union the contract's Category enum covers. */
export const CATEGORY_CANDIDATES: readonly CategoryValue[] = Category.options;

/**
 * POST /api/filter-list/ `list_field` candidates. Exactly the set named by
 * the owning task, tried in this order. `probeListField` additionally folds
 * in anything filter-configs' facet dump surfaces that looks like a list
 * selector (see `extractListFieldHints`) — those are tagged
 * `source: "filter-configs"` in the report so it's clear which candidates
 * were hypothesized up front vs. discovered live.
 */
export const LIST_FIELD_CANDIDATES: readonly string[] = [
  "TRENDING",
  "BEEN",
  "RANKED",
  "RANK",
  "WANT_TO_TRY",
  "WANTTOTRY",
  "BOOKMARK",
  "BOOKMARKED",
  "RECS",
  "REC",
  "RECOMMENDED",
  "FRIEND_RECS",
];

const OVERLAP_THRESHOLD = 0.5;

/**
 * How much better a candidate's overlap with one list must be than its overlap
 * with the other before we call it a resolution.
 *
 * Without this, a candidate returning a 50/50 mix of Been and Want-to-Try ids
 * clears OVERLAP_THRESHOLD against BOTH references and gets reported as being
 * both lists at once — a confident contradiction. A candidate that cannot be
 * separated is an ambiguous result, which is a finding, not a resolution.
 */
const OVERLAP_SEPARATION = 0.15;

// ---------------------------------------------------------------------------
// Step 1 — host reachability
// ---------------------------------------------------------------------------

/**
 * Recognise a proxy-origin refusal. Kept deliberately narrow: it must not
 * misclassify a genuine 403 from Beli (which the API returns for a missing
 * User-Agent/Origin) as an egress block.
 */
export async function detectEgressBlock(res: Response): Promise<string | null> {
  if (res.status !== 403 && res.status !== 407) return null;
  let body = "";
  try {
    body = (await res.clone().text()).slice(0, 500);
  } catch {
    return null;
  }
  const m = body.match(/not in allowlist|allowlist|egress|proxy|forbidden by policy/i);
  if (!m) return null;
  return body.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Recognise a proxy-origin refusal that arrives as a *thrown error* rather than
 * a response.
 *
 * A default-deny proxy can refuse a host in two quite different ways, and the
 * response-based {@link detectEgressBlock} above only sees the first:
 *
 *  1. It answers the request with its own 403/407 body — a real `Response`.
 *  2. It refuses the CONNECT tunnel outright. For an HTTPS URL this is the
 *     usual case, and no response ever exists: undici raises
 *     `TypeError: fetch failed` whose nested cause reads
 *     `Proxy response (403) !== 200 when HTTP Tunneling`.
 *
 * Case 2 previously fell through to the generic catch and was reported as
 * `UNREACHABLE — fetch failed`, which points at the wrong problem entirely: the
 * host is fine, the egress policy is not. Only 403 and 407 count as a policy
 * denial — a 502 from the proxy is an upstream failure, not an allowlist miss.
 */
export function detectEgressBlockFromError(err: unknown): string | null {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 8; depth++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const message = cur instanceof Error ? cur.message : String(cur);

    const tunnel = message.match(
      /Proxy response \((\d{3})\) !== 200 when HTTP Tunneling/i,
    );
    if (tunnel) {
      const status = Number(tunnel[1]);
      if (status === 403 || status === 407) {
        return `proxy refused CONNECT tunnel with ${status}`;
      }
      return null;
    }

    if (/\b(407|proxy authentication required)\b/i.test(message)) {
      return "proxy demanded authentication (407)";
    }

    cur = (cur as { cause?: unknown } | null)?.cause;
  }
  return null;
}

async function probeHost(host: HostKey, timeoutMs = 5000): Promise<HostReachability> {
  const url = HOSTS[host];
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Origin: META.requiredHeaders.Origin,
        Referer: META.requiredHeaders.Referer,
      },
    });
    // A server answered — but check it was Beli and not an egress proxy
    // refusing the host, which is a block, not reachability.
    const block = await detectEgressBlock(res);
    if (block) {
      return {
        host,
        url,
        reachable: false,
        status: res.status,
        ms: Date.now() - start,
        blockedByEgress: true,
        error: `blocked by network egress policy (${block})`,
      };
    }
    // Otherwise any HTTP status (even 403/404 from Beli itself) proves the
    // host is up and routable from here.
    return { host, url, reachable: true, status: res.status, ms: Date.now() - start };
  } catch (err) {
    // No response at all. Before calling the host unreachable, check whether
    // the proxy refused the tunnel — that is a policy block, not a dead host.
    const block = detectEgressBlockFromError(err);
    if (block) {
      return {
        host,
        url,
        reachable: false,
        status: null,
        ms: Date.now() - start,
        blockedByEgress: true,
        error: `blocked by network egress policy (${block})`,
      };
    }
    return {
      host,
      url,
      reachable: false,
      status: null,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeHosts(): Promise<HostReachability[]> {
  const keys = Object.keys(HOSTS) as HostKey[];
  const out: HostReachability[] = [];
  for (const key of keys) {
    out.push(await probeHost(key));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 2 — session state
// ---------------------------------------------------------------------------

async function probeSession(client: BeliClient, config: Config): Promise<SessionProbe> {
  const refreshTokenPresent = client.hasRefreshToken();
  const credentialsAvailable = Boolean((config.email || config.phone) && config.password);
  const credentialIdentifierType: SessionProbe["credentialIdentifierType"] = config.email
    ? "email"
    : config.phone
      ? "phone"
      : "none";

  const out: SessionProbe = {
    refreshTokenPresent,
    refreshTokenPreview: client.refreshTokenPreview ?? "(none)",
    refreshTokenValid: null,
    credentialsAvailable,
    credentialIdentifierType,
    loginAttempted: false,
    loginSucceeded: null,
    accessTokenPreview: "(none)",
    authenticated: false,
    userId: null,
  };

  // Test the stored refresh token in isolation (no fallback to login here) so
  // "refresh exists but expired" is distinguishable from "no refresh at all".
  if (refreshTokenPresent) {
    try {
      await client.refreshToken();
      out.refreshTokenValid = true;
    } catch (err) {
      out.refreshTokenValid = false;
      out.refreshError = errInfo(err).message;
    }
  }

  // If credentials are configured, attempt a real login regardless of the
  // refresh outcome above — this is the step that resolves the account uuid
  // when no session was on disk at all, and re-validates credentials that
  // may have changed even when an old refresh token still works.
  if (credentialsAvailable && !(out.refreshTokenValid === true)) {
    out.loginAttempted = true;
    try {
      await client.login();
      out.loginSucceeded = true;
    } catch (err) {
      out.loginSucceeded = false;
      out.loginError = errInfo(err).message;
    }
  }

  out.accessTokenPreview = client.accessTokenPreview ?? "(none)";
  out.authenticated = client.isAuthenticated() && Boolean(client.userId);
  out.userId = client.userId;
  return out;
}

// ---------------------------------------------------------------------------
// Step 3 — category enum resolution
// ---------------------------------------------------------------------------

async function probeCategories(
  client: BeliClient,
  userId: string,
  throttle: () => Promise<void>,
): Promise<ProbeReport["categories"]> {
  const results: CategoryProbeResult[] = [];
  for (const category of CATEGORY_CANDIDATES) {
    await throttle();
    try {
      const res = await client.request("getRanking", { query: { user: userId, category } });
      results.push({
        category,
        ok: true,
        status: 200,
        resultCount: res.results.length,
      });
    } catch (err) {
      const { status, message } = errInfo(err);
      results.push({ category, ok: false, status, resultCount: null, error: message });
    }
  }
  return {
    skipped: false,
    candidatesTried: [...CATEGORY_CANDIDATES],
    results,
    accepted: results.filter((r) => r.ok).map((r) => r.category),
  };
}

// ---------------------------------------------------------------------------
// Step 4 — list_field resolution (the critical unknown)
// ---------------------------------------------------------------------------

function extractIds(res: { results: number[] }): number[] {
  return res.results;
}

function computeOverlap(candidateIds: number[], reference: Set<number>): Overlap {
  return { matched: candidateIds.filter((id) => reference.has(id)).length, total: candidateIds.length };
}

/**
 * Is a candidate's overlap with one list decisive — clearing the threshold AND
 * beating the other list by a clear margin?
 *
 * `available` guards the case where the reference list could not be fetched at
 * all. An unfetched reference yields an empty id set, which scores 0 overlap
 * for every candidate — indistinguishable from "genuinely didn't match" unless
 * we track it. Treating unknown as zero would let a Been field be misfiled as
 * something else purely because get-ranking happened to fail.
 */
function isDecisive(primary: Overlap, other: Overlap, available: boolean): boolean {
  if (!available || primary.total === 0) return false;
  const p = primary.matched / primary.total;
  if (p < OVERLAP_THRESHOLD) return false;
  const o = other.total > 0 ? other.matched / other.total : 0;
  return p >= o + OVERLAP_SEPARATION;
}

function concludeCandidate(
  been: Overlap,
  wantToTry: Overlap,
  beenAvailable: boolean,
  wttAvailable: boolean,
): string {
  if (been.total === 0 && wantToTry.total === 0) {
    return "no ids returned — cannot classify against Been or Want-to-Try";
  }
  const beenFrac = been.total > 0 ? been.matched / been.total : 0;
  const wttFrac = wantToTry.total > 0 ? wantToTry.matched / wantToTry.total : 0;

  if (isDecisive(been, wantToTry, beenAvailable)) {
    return `${been.matched}/${been.total} returned ids appear in get-ranking -> BEEN list`;
  }
  if (isDecisive(wantToTry, been, wttAvailable)) {
    return `${wantToTry.matched}/${wantToTry.total} returned ids appear in get-bookmark -> WANT_TO_TRY list`;
  }

  // Cleared the bar against both references but separated by neither — say so
  // rather than picking the larger of two indistinguishable numbers.
  if (beenFrac >= OVERLAP_THRESHOLD && wttFrac >= OVERLAP_THRESHOLD) {
    return (
      `AMBIGUOUS — overlaps Been (${been.matched}/${been.total}) and ` +
      `Want-to-Try (${wantToTry.matched}/${wantToTry.total}) too evenly to tell ` +
      `them apart; not resolved`
    );
  }

  const unavailable: string[] = [];
  if (!beenAvailable) unavailable.push("Been (get-ranking failed)");
  if (!wttAvailable) unavailable.push("Want-to-Try (get-bookmark failed)");
  if (unavailable.length > 0) {
    return (
      `cannot classify — reference list unavailable: ${unavailable.join(", ")}. ` +
      `Overlap against a list that was never fetched is meaningless, not zero.`
    );
  }

  return (
    `low/no overlap with Been (${been.matched}/${been.total}) or ` +
    `Want-to-Try (${wantToTry.matched}/${wantToTry.total}) — likely RECS, ` +
    `a third list, or an invalid list_field value; see the recs probe below.`
  );
}

/**
 * Best-effort scan of an unknown filter-configs/filter-options payload for
 * anything that looks like a list-selector facet (a key/field/name close to
 * "list", plus whatever string options sit alongside it). Purely additive —
 * on any shape mismatch it returns no hints and the static candidate list is
 * used unmodified. This is what satisfies "extend if the facet configs
 * suggest more" from the owning task.
 */
export function extractListFieldHints(data: unknown): string[] {
  const hints = new Set<string>();
  const LIST_KEY_RE = /list.?field|list.?type|^list$/i;
  const CANDIDATE_VALUE_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

  const collectFrom = (node: unknown): void => {
    for (const s of flattenStrings(node)) {
      if (CANDIDATE_VALUE_RE.test(s)) hints.add(s);
    }
  };

  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 500)) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    // Case A: a property NAME looks list-y (e.g. `"list_field": [...]`) —
    // its own value is the candidate set.
    for (const [key, value] of Object.entries(obj)) {
      if (LIST_KEY_RE.test(key)) collectFrom(value);
    }

    // Case B: a "key"/"field"/"name" VALUE looks list-y (e.g.
    // `{ key: "LIST_FIELD", options: [...] }`, the FilterClause shape used
    // elsewhere in this contract) — pull sibling option arrays.
    for (const nameField of ["key", "field", "name"]) {
      const v = obj[nameField];
      if (typeof v === "string" && LIST_KEY_RE.test(v)) {
        for (const optField of ["options", "values", "value", "choices", "enum"]) {
          if (optField in obj) collectFrom(obj[optField]);
        }
      }
    }

    for (const value of Object.values(obj)) visit(value, depth + 1);
  };

  visit(data, 0);
  return [...hints];
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(flattenStrings);
  }
  return [];
}

async function probeListField(
  client: BeliClient,
  userId: string,
  throttle: () => Promise<void>,
  extraCandidates: string[],
): Promise<ListFieldProbe> {
  // Reference sets: the known-good Been and Want-to-Try lists for this
  // account/category, fetched once and reused for every candidate's overlap
  // check (this is the id-overlap evidence standard, not name plausibility).
  await throttle();
  let beenIds: Set<number>;
  let beenIdCount: number | null;
  try {
    const been = await client.getBeen("RES", userId);
    const ids = been.results.map((r) => r.business.id);
    beenIds = new Set(ids);
    beenIdCount = ids.length;
  } catch {
    beenIds = new Set();
    beenIdCount = null;
  }

  await throttle();
  let wantToTryIds: Set<number>;
  let wantToTryIdCount: number | null;
  try {
    const wtt = await client.getWantToTry("RES", userId);
    const ids = Object.values(wtt)
      .flat()
      .map((item) => item.business.id);
    wantToTryIds = new Set(ids);
    wantToTryIdCount = ids.length;
  } catch {
    wantToTryIds = new Set();
    wantToTryIdCount = null;
  }

  const candidateList = [...new Set([...LIST_FIELD_CANDIDATES, ...extraCandidates])];
  const requestTemplate = {
    filters: [],
    list_field: "<candidate>",
    user: userId,
    user2: userId, // observed live even for single-user queries (reference §6)
    category: "RES",
    bounds: null,
    sort_method: "Most Trending", // only value ever observed; held constant across candidates
    load_businesses: true,
  };

  const results: ListFieldCandidateResult[] = [];
  for (const candidate of candidateList) {
    await throttle();
    const source: ListFieldCandidateResult["source"] = LIST_FIELD_CANDIDATES.includes(candidate)
      ? "static"
      : "filter-configs";
    try {
      const res = await client.request("filterList", {
        body: {
          filters: [],
          list_field: candidate,
          user: userId,
          user2: userId,
          category: "RES",
          bounds: null,
          sort_method: "Most Trending",
          load_businesses: true,
        },
      });
      const ids = extractIds(res);
      const overlapBeen = computeOverlap(ids, beenIds);
      const overlapWantToTry = computeOverlap(ids, wantToTryIds);
      results.push({
        candidate,
        source,
        ok: true,
        status: 200,
        count: res.count ?? ids.length,
        sampleIds: ids.slice(0, 5),
        overlapBeen,
        overlapWantToTry,
        conclusion: concludeCandidate(
          overlapBeen,
          overlapWantToTry,
          beenIdCount !== null,
          wantToTryIdCount !== null,
        ),
      });
    } catch (err) {
      const { status, message } = errInfo(err);
      results.push({
        candidate,
        source,
        ok: false,
        status,
        count: null,
        sampleIds: [],
        error: message,
        overlapBeen: null,
        overlapWantToTry: null,
        conclusion: "request failed — see error",
      });
    }
  }

  // A pick must be DECISIVE — clear the overlap threshold and beat the other
  // list by a clear margin — so a candidate returning a mix of both lists is
  // reported as ambiguous rather than claimed as both.
  const pickBest = (key: "overlapBeen" | "overlapWantToTry"): string | null => {
    const otherKey = key === "overlapBeen" ? "overlapWantToTry" : "overlapBeen";
    const available = key === "overlapBeen" ? beenIdCount !== null : wantToTryIdCount !== null;
    let best: { candidate: string; frac: number; matched: number } | null = null;
    for (const r of results) {
      const overlap = r[key];
      const other = r[otherKey];
      if (!overlap || !other) continue;
      if (!isDecisive(overlap, other, available)) continue;
      const frac = overlap.matched / overlap.total;
      if (!best || frac > best.frac || (frac === best.frac && overlap.matched > best.matched)) {
        best = { candidate: r.candidate, frac, matched: overlap.matched };
      }
    }
    return best?.candidate ?? null;
  };

  const bestBeenCandidate = pickBest("overlapBeen");
  let bestWantToTryCandidate = pickBest("overlapWantToTry");

  // Belt and braces: isDecisive should already make this impossible, but a
  // single field reported as being two different lists is the one outcome that
  // must never reach a report, so refuse it explicitly rather than trust the
  // arithmetic above.
  if (bestBeenCandidate !== null && bestBeenCandidate === bestWantToTryCandidate) {
    bestWantToTryCandidate = null;
  }
  const unresolvedCandidates = results
    .filter((r) => r.ok && r.candidate !== bestBeenCandidate && r.candidate !== bestWantToTryCandidate)
    .map((r) => r.candidate);

  return {
    skipped: false,
    requestTemplate,
    beenIdCount,
    wantToTryIdCount,
    candidates: results,
    bestBeenCandidate,
    bestWantToTryCandidate,
    unresolvedCandidates,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — filter-configs / filter-options facet dump
// ---------------------------------------------------------------------------

function summarizeFacets(data: unknown): { topLevelKeys: string[]; facetKeys: string[] } {
  const topLevelKeys: string[] =
    data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data as object) : [];
  const facetKeys = new Set<string>();
  const NAME_FIELDS = ["key", "field", "name", "id", "label"];
  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 300)) visit(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const f of NAME_FIELDS) {
        const v = obj[f];
        if (typeof v === "string" && v.length > 0 && v.length < 60) facetKeys.add(v);
      }
      for (const v of Object.values(obj)) visit(v, depth + 1);
    }
  };
  visit(data, 0);
  return { topLevelKeys, facetKeys: [...facetKeys].slice(0, 100) };
}

async function fetchFilterConfigs(
  client: BeliClient,
): Promise<{ ok: boolean; status: number | null; error?: string; raw: unknown }> {
  try {
    const raw = await client.request("filterConfigs");
    return { ok: true, status: 200, raw };
  } catch (err) {
    const { status, message } = errInfo(err);
    return { ok: false, status, error: message, raw: undefined };
  }
}

async function fetchFilterOptions(
  client: BeliClient,
): Promise<{ ok: boolean; status: number | null; error?: string; raw: unknown }> {
  try {
    const raw = await client.request("filterOptions", { body: {} });
    return { ok: true, status: 200, raw };
  } catch (err) {
    const { status, message } = errInfo(err);
    return { ok: false, status, error: message, raw: undefined };
  }
}

// ---------------------------------------------------------------------------
// Step 6 — recs shape probe
// ---------------------------------------------------------------------------

function classifyShape(data: unknown): RecsShape {
  if (Array.isArray(data)) return data.length === 0 ? "empty" : "curated-list";
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results.length === 0 ? "empty" : "curated-list";
    const keys = Object.keys(obj);
    if (
      keys.length > 0 &&
      keys.every((k) => /^\d+$/.test(k)) &&
      Object.values(obj).every((v) => typeof v === "number")
    ) {
      return "score-map";
    }
    return "unknown";
  }
  return "unknown";
}

async function probeRecs(client: BeliClient, userId: string, throttle: () => Promise<void>): Promise<RecsProbe> {
  await throttle();
  const recsOut: RecsProbe["recs"] = { ok: false, status: null, shape: "not-run", itemCount: null };
  try {
    const raw = await client.request("recs", { params: { userId } });
    const shape = classifyShape(raw);
    const itemCount = Array.isArray(raw) ? raw.length : raw.results.length;
    recsOut.ok = true;
    recsOut.status = 200;
    recsOut.shape = shape;
    recsOut.itemCount = itemCount;
  } catch (err) {
    const { status, message } = errInfo(err);
    recsOut.status = status;
    recsOut.error = message;
  }

  await throttle();
  const scoreOut: RecsProbe["recScore"] = { ok: false, status: null, shape: "not-run" };
  try {
    const raw = await client.request("recScore");
    scoreOut.ok = true;
    scoreOut.status = 200;
    scoreOut.shape = classifyShape(raw);
  } catch (err) {
    const { status, message } = errInfo(err);
    scoreOut.status = status;
    scoreOut.error = message;
  }

  return { skipped: false, recs: recsOut, recScore: scoreOut };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RunProbeOptions {
  client: BeliClient;
  config: Config;
  throttle?: () => Promise<void>;
}

export async function runProbe({ client, config, throttle }: RunProbeOptions): Promise<ProbeReport> {
  const tick = throttle ?? makeThrottle(config.minIntervalMs);

  // Step 0 — make sure a configured proxy is actually in use before we judge
  // any host unreachable. Installing it here (rather than only at CLI start)
  // keeps `beli_doctor` honest when the probe runs inside the MCP server.
  const proxy = await installProxySupport();

  // Step 1 — always runs, never depends on auth.
  const hosts = await probeHosts();

  // Step 2 — session state (+ headless login if creds are configured).
  const session = await probeSession(client, config);

  const userId = session.userId;
  // When the hosts are blocked, authentication could never have succeeded no
  // matter how the credentials were set. Saying "set BELI_EMAIL" in that case
  // sends the reader to fix something that is already correct.
  const blockedHosts = hosts.filter((h) => h.blockedByEgress);
  const notAuthReason = !userId
    ? blockedHosts.length > 0
      ? `could not authenticate — ${blockedHosts.length} of ${hosts.length} Beli hosts are ` +
        "blocked by this environment's network egress policy. Add them to the " +
        "environment's allowed domains; no credential change will help until then."
      : "not authenticated — no valid refresh token and no usable credentials " +
        "(set BELI_EMAIL or BELI_PHONE + BELI_PASSWORD, or run `beli-mcp-plus login`)"
    : undefined;

  // Steps 3-6 all need an authenticated uuid; skip cleanly (not a crash) when absent.
  let categories: ProbeReport["categories"];
  let listField: ListFieldProbe;
  let facets: FacetProbe;
  let recs: RecsProbe;

  if (!userId) {
    categories = { skipped: true, skipReason: notAuthReason, candidatesTried: [], results: [], accepted: [] };
    listField = {
      skipped: true,
      skipReason: notAuthReason,
      beenIdCount: null,
      wantToTryIdCount: null,
      candidates: [],
      bestBeenCandidate: null,
      bestWantToTryCandidate: null,
      unresolvedCandidates: [],
    };
    facets = {
      skipped: true,
      skipReason: notAuthReason,
      filterConfigs: { ok: false, status: null, topLevelKeys: [], facetKeys: [] },
      filterOptions: { ok: false, status: null, topLevelKeys: [], facetKeys: [] },
    };
    recs = {
      skipped: true,
      skipReason: notAuthReason,
      recs: { ok: false, status: null, shape: "not-run", itemCount: null },
      recScore: { ok: false, status: null, shape: "not-run" },
    };
  } else {
    categories = await probeCategories(client, userId, tick);

    // Fetch filter-configs once, early, so its facet dump can extend the
    // list_field candidate set before we spend requests on it (see
    // `extractListFieldHints`) — then reuse the same response for the
    // step-5 facet report below instead of fetching it twice.
    const filterConfigsResult = await (async () => {
      await tick();
      return fetchFilterConfigs(client);
    })();
    const hints = filterConfigsResult.ok ? extractListFieldHints(filterConfigsResult.raw) : [];

    listField = await probeListField(client, userId, tick, hints);

    const filterOptionsResult = await fetchFilterOptions(client);
    facets = {
      skipped: false,
      filterConfigs: {
        ok: filterConfigsResult.ok,
        status: filterConfigsResult.status,
        error: filterConfigsResult.error,
        ...summarizeFacets(filterConfigsResult.raw),
      },
      filterOptions: {
        ok: filterOptionsResult.ok,
        status: filterOptionsResult.status,
        error: filterOptionsResult.error,
        ...summarizeFacets(filterOptionsResult.raw),
      },
    };

    recs = await probeRecs(client, userId, tick);
  }

  return {
    generatedAt: new Date().toISOString(),
    appVersion: META.appVersion,
    proxy,
    hosts,
    session,
    categories,
    listField,
    facets,
    recs,
  };
}

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

function listFieldSummaryLines(lf: ListFieldProbe): string[] {
  if (lf.skipped) return [`  list_field:  SKIPPED — ${lf.skipReason}`];
  const lines: string[] = [];
  lines.push(
    `  list_field:  BEEN -> ${lf.bestBeenCandidate ?? "UNRESOLVED"}   ` +
      `WANT_TO_TRY -> ${lf.bestWantToTryCandidate ?? "UNRESOLVED"}`,
  );
  if (lf.unresolvedCandidates.length > 0) {
    lines.push(`               unresolved/other: ${lf.unresolvedCandidates.join(", ") || "(none)"}`);
  }
  return lines;
}

export function formatHumanReport(report: ProbeReport): string {
  const lines: string[] = [];
  const reachableCount = report.hosts.filter((h) => h.reachable).length;

  lines.push("=".repeat(60));
  lines.push("BELI DOCTOR — FINDINGS SUMMARY");
  lines.push("=".repeat(60));
  const blockedCount = report.hosts.filter((h) => h.blockedByEgress).length;
  lines.push(
    blockedCount > 0
      ? `  hosts reachable:  ${reachableCount}/${report.hosts.length}  ` +
          `(${blockedCount} BLOCKED by network egress policy — add them to this ` +
          `environment's allowed domains)`
      : `  hosts reachable:  ${reachableCount}/${report.hosts.length}`,
  );
  lines.push(
    `  auth:             ${report.session.authenticated ? `authenticated as ${report.session.userId}` : "NOT authenticated"}`,
  );
  if (report.categories.skipped) {
    lines.push(`  category enum:    SKIPPED — ${report.categories.skipReason}`);
  } else {
    lines.push(
      `  category enum:    accepted [${report.categories.accepted.join(", ") || "none"}] of ` +
        `[${report.categories.candidatesTried.join(", ")}]`,
    );
  }
  lines.push(...listFieldSummaryLines(report.listField));
  if (report.facets.skipped) {
    lines.push(`  facets:           SKIPPED — ${report.facets.skipReason}`);
  } else {
    lines.push(
      `  facets:           filter-configs ${report.facets.filterConfigs.ok ? "ok" : "FAILED"}, ` +
        `filter-options ${report.facets.filterOptions.ok ? "ok" : "FAILED"}`,
    );
  }
  if (report.recs.skipped) {
    lines.push(`  recs shape:       SKIPPED — ${report.recs.skipReason}`);
  } else {
    lines.push(
      `  recs shape:       /api/recs/ -> ${report.recs.recs.shape}, ` +
        `/api/rec-score/ -> ${report.recs.recScore.shape}`,
    );
  }
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("1. HOST REACHABILITY");
  lines.push("-".repeat(60));
  if (report.proxy.mode !== "none") {
    lines.push(`  proxy: ${report.proxy.mode} ${report.proxy.proxyUrl ?? ""}`.trimEnd());
  }
  if (report.proxy.warning) {
    lines.push(`  WARNING: ${report.proxy.warning}`);
  }
  for (const h of report.hosts) {
    lines.push(
      `  ${h.host.padEnd(9)} ${
        h.reachable
          ? `reachable (status ${h.status}, ${h.ms}ms)`
          : h.blockedByEgress
            ? `BLOCKED BY EGRESS POLICY — ${h.error}`
            : `UNREACHABLE — ${h.error}`
      }  ${h.url}`,
    );
  }
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("2. SESSION");
  lines.push("-".repeat(60));
  const s = report.session;
  lines.push(`  refresh token present: ${s.refreshTokenPresent} (${s.refreshTokenPreview})`);
  lines.push(`  refresh token valid:   ${s.refreshTokenValid === null ? "n/a" : s.refreshTokenValid}`);
  if (s.refreshError) lines.push(`    refresh error: ${s.refreshError}`);
  lines.push(
    `  credentials available: ${s.credentialsAvailable} (identifier: ${s.credentialIdentifierType})`,
  );
  lines.push(`  login attempted:       ${s.loginAttempted}`);
  lines.push(`  login succeeded:       ${s.loginSucceeded === null ? "n/a" : s.loginSucceeded}`);
  if (s.loginError) lines.push(`    login error: ${s.loginError}`);
  lines.push(`  access token:          ${s.accessTokenPreview}`);
  lines.push(`  resolved user id:      ${s.userId ?? "(none)"}`);
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("3. CATEGORY ENUM (GET /api/get-ranking/)");
  lines.push("-".repeat(60));
  if (report.categories.skipped) {
    lines.push(`  skipped — ${report.categories.skipReason}`);
  } else {
    for (const r of report.categories.results) {
      lines.push(
        `  ${r.category.padEnd(8)} ${r.ok ? `OK  (${r.resultCount} results)` : `FAIL status=${r.status ?? "?"} ${r.error ?? ""}`}`,
      );
    }
  }
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("4. list_field (POST /api/filter-list/) — THE CRITICAL UNKNOWN");
  lines.push("-".repeat(60));
  if (report.listField.skipped) {
    lines.push(`  skipped — ${report.listField.skipReason}`);
  } else {
    lines.push(`  reference Been list size:        ${report.listField.beenIdCount ?? "unavailable"}`);
    lines.push(`  reference Want-to-Try list size: ${report.listField.wantToTryIdCount ?? "unavailable"}`);
    lines.push("");
    for (const c of report.listField.candidates) {
      lines.push(`  ${c.candidate} [${c.source}]`);
      if (!c.ok) {
        lines.push(`    FAILED status=${c.status ?? "?"} ${c.error ?? ""}`);
        continue;
      }
      lines.push(`    status=200 count=${c.count} sample_ids=[${c.sampleIds.join(", ")}]`);
      lines.push(`    -> ${c.conclusion}`);
    }
  }
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("5. FACET CONFIGS (GET /api/filter-configs/, POST /api/filter-options/)");
  lines.push("-".repeat(60));
  if (report.facets.skipped) {
    lines.push(`  skipped — ${report.facets.skipReason}`);
  } else {
    const fc = report.facets.filterConfigs;
    const fo = report.facets.filterOptions;
    lines.push(`  filter-configs: ${fc.ok ? "200" : `FAILED status=${fc.status ?? "?"} ${fc.error ?? ""}`}`);
    if (fc.ok) {
      lines.push(`    top-level keys: ${fc.topLevelKeys.join(", ") || "(none)"}`);
      lines.push(`    facet keys:     ${fc.facetKeys.join(", ") || "(none found)"}`);
    }
    lines.push(`  filter-options: ${fo.ok ? "200" : `FAILED status=${fo.status ?? "?"} ${fo.error ?? ""}`}`);
    if (fo.ok) {
      lines.push(`    top-level keys: ${fo.topLevelKeys.join(", ") || "(none)"}`);
      lines.push(`    facet keys:     ${fo.facetKeys.join(", ") || "(none found)"}`);
    }
  }
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("6. RECS (GET {RECS}/api/recs/{uuid}/, GET /api/rec-score/)");
  lines.push("-".repeat(60));
  if (report.recs.skipped) {
    lines.push(`  skipped — ${report.recs.skipReason}`);
  } else {
    const r = report.recs.recs;
    const rs = report.recs.recScore;
    lines.push(
      `  /api/recs/{uuid}/:  ${r.ok ? `200, shape=${r.shape}, items=${r.itemCount ?? "n/a"}` : `FAILED status=${r.status ?? "?"} ${r.error ?? ""}`}`,
    );
    lines.push(
      `  /api/rec-score/:    ${rs.ok ? `200, shape=${rs.shape}` : `FAILED status=${rs.status ?? "?"} ${rs.error ?? ""}`}`,
    );
    lines.push(
      `  verdict: ${r.shape === "curated-list" ? "looks like a CURATED LIST of places" : r.shape === "score-map" ? "looks like a SCORE MAP keyed by business id" : "shape unconfirmed"}`,
    );
  }

  lines.push("");
  lines.push(`(generated ${report.generatedAt}, app v${report.appVersion})`);

  return lines.join("\n");
}
