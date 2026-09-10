import { HOSTS, META, type HostKey } from "@beli/contract";

/** Error thrown for non-2xx API responses, carrying status + body for triage. */
export class BeliApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    readonly body: string,
  ) {
    super(`Beli API ${endpoint} -> ${status}: ${body.slice(0, 300)}`);
    this.name = "BeliApiError";
  }
}

/**
 * Defense-in-depth for the login endpoint: if Beli's API ever echoed a
 * submitted field back in an error body (naive validation-error responses
 * sometimes do this), a raw `password` value must never reach a thrown
 * error's `message` — which callers (CLI, MCP tool results, logs) may print
 * at any log level. Strips any top-level `"password"` value out of a JSON (or
 * JSON-ish) response body before it's used to build an error message.
 */
export function redactPasswordField(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(parsed, "password")) {
      parsed.password = "[redacted]";
    }
    return JSON.stringify(parsed);
  } catch {
    // Not JSON (or malformed) — fall back to a best-effort text redaction.
    return text.replace(/("password"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[redacted]"');
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; SM-S928U) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.7827.91 Mobile Safari/537.36";

/** Headers every request must carry (Origin/Referer are gateway requirements). */
export function baseHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    Origin: META.requiredHeaders.Origin,
    Referer: META.requiredHeaders.Referer,
    "User-Agent": USER_AGENT,
  };
}

/** Build a full URL from a host key, path template, path params and query. */
export function buildUrl(
  host: HostKey,
  path: string,
  params?: Record<string, string | number>,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  let filled = path;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      filled = filled.replace(`{${k}}`, encodeURIComponent(String(v)));
    }
  }
  const url = new URL(HOSTS[host] + filled);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}
