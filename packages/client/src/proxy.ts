/**
 * Proxy support for Node's global `fetch`.
 *
 * Node's built-in fetch (undici) ignores `HTTPS_PROXY` unless it is explicitly
 * told otherwise. On a machine that reaches the internet only through a proxy —
 * a corporate network, a CI runner, a sandboxed cloud session — every request
 * therefore bypasses the proxy and fails with an error that names DNS or a
 * timeout rather than the proxy. The failure looks like "Beli is down" when the
 * truth is "this process never used the proxy it was given".
 *
 * Two mechanisms can fix that, in order of preference:
 *
 *  1. `NODE_USE_ENV_PROXY=1` — built into Node >= 22.21, no dependency. It must
 *     be set before the process starts, so we can only detect it, not enable it.
 *  2. undici's `EnvHttpProxyAgent` installed as the global dispatcher. undici is
 *     an optional dependency: when it is absent we degrade to a warning rather
 *     than failing to start.
 *
 * When neither is available the caller gets an actionable warning instead of
 * silent misrouting, which is the whole point of this module.
 */

/** How outbound HTTPS is (or is not) being routed through a proxy. */
export type ProxyMode =
  /** No proxy configured in the environment; direct connections. */
  | "none"
  /** Node's own env-proxy support is active (`NODE_USE_ENV_PROXY=1`). */
  | "node-env-proxy"
  /** undici's EnvHttpProxyAgent was installed as the global dispatcher. */
  | "undici-agent"
  /** A proxy is configured but nothing is honouring it — requests will bypass it. */
  | "unconfigured";

export interface ProxyStatus {
  mode: ProxyMode;
  /** The proxy URL found in the environment, with any credentials stripped. */
  proxyUrl: string | null;
  /** Present when `mode` is `"unconfigured"`; safe to print verbatim. */
  warning?: string;
}

/** Read the proxy URL from the environment, honouring the usual casing pairs. */
function readProxyEnv(env: NodeJS.ProcessEnv): string | null {
  return env.HTTPS_PROXY ?? env.https_proxy ?? env.ALL_PROXY ?? env.all_proxy ?? null;
}

/**
 * Strip any `user:password@` credentials from a proxy URL so the result can be
 * logged. A malformed URL yields `null` rather than risking echoing a secret.
 */
export function redactProxyUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return `${u.origin} (credentials redacted)`;
    }
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Install proxy support for global `fetch` if the environment asks for it.
 *
 * Idempotent and safe to call unconditionally at process start. Never throws:
 * a proxy that cannot be installed is reported through the return value so the
 * caller decides how loudly to complain.
 */
export async function installProxySupport(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProxyStatus> {
  const raw = readProxyEnv(env);
  if (!raw) return { mode: "none", proxyUrl: null };

  const proxyUrl = redactProxyUrl(raw);

  // Node is already routing through the proxy itself; installing a dispatcher
  // on top would be redundant.
  if (env.NODE_USE_ENV_PROXY === "1") {
    return { mode: "node-env-proxy", proxyUrl };
  }

  try {
    const undici = (await import("undici")) as {
      EnvHttpProxyAgent?: new () => unknown;
      setGlobalDispatcher?: (d: unknown) => void;
    };
    if (undici.EnvHttpProxyAgent && undici.setGlobalDispatcher) {
      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
      return { mode: "undici-agent", proxyUrl };
    }
  } catch {
    // undici not installed — fall through to the warning.
  }

  return {
    mode: "unconfigured",
    proxyUrl,
    warning:
      `A proxy is configured (${proxyUrl ?? "unparseable proxy URL"}) but this ` +
      `Node process is not using it, so requests will bypass it and appear to ` +
      `fail as network errors. Re-run with NODE_USE_ENV_PROXY=1 (Node >= 22.21), ` +
      `or install the optional 'undici' dependency.`,
  };
}
