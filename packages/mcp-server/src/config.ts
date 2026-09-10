import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Runtime configuration resolved from environment variables. */
export interface Config {
  /** Exactly one of `email`/`phone` is set when credentials fully resolved. */
  email?: string;
  phone?: string;
  password?: string;
  sessionPath: string;
  draftsPath: string;
  /** `$BELI_HOME/config.json` — optional file-based credential source. */
  configPath: string;
  /** When false, write tools require an explicit `confirm: true` argument. */
  allowWrites: boolean;
  /** Minimum ms between API calls (politeness throttle). */
  minIntervalMs: number;
  /** When true, never launch a browser (headless/CI); disables auto-login popups. */
  noBrowser: boolean;
  /** Where `probe` writes its machine-readable report (default: ./probe-report.json). */
  probeOutputPath: string;
}

interface RawCreds {
  email?: string;
  phone?: string;
  password?: string;
}

/**
 * A credential source only counts as a "match" if it supplies a password and
 * at least one identifier. Enforcing "exactly one" (not both) is left to
 * `login()` — so a source with BOTH email and phone still counts as a match
 * here (rather than silently falling through to the next source) and instead
 * surfaces as `login()`'s clean "not both" error.
 */
function usableCreds(c: RawCreds | undefined): RawCreds | undefined {
  if (!c || !c.password) return undefined;
  if (!c.email && !c.phone) return undefined;
  return c;
}

/**
 * Read `$BELI_HOME/config.json` (optional file-based credential source). If
 * the file exists but its permissions are more open than 0600 (any group/
 * other bit set), it is NOT read — a warning is printed to stderr and the
 * file is ignored, so credentials are never pulled out of a world-readable
 * file.
 */
function readConfigFile(path: string): RawCreds | undefined {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return undefined; // no config file — not an error
  }
  const mode = stat.mode & 0o777;
  if (mode & 0o077) {
    process.stderr.write(
      `beli-mcp: ignoring ${path} — permissions ${mode
        .toString(8)
        .padStart(3, "0")} are more open than 0600. Run \`chmod 600 ${path}\` to use it.\n`,
    );
    return undefined;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      phone: typeof parsed.phone === "string" ? parsed.phone : undefined,
      password: typeof parsed.password === "string" ? parsed.password : undefined,
    };
  } catch (err) {
    process.stderr.write(
      `beli-mcp: failed to read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }
}

/**
 * Resolve credentials, first match wins:
 *   1. Environment variables — BELI_EMAIL or BELI_PHONE, plus BELI_PASSWORD.
 *   2. `$BELI_HOME/config.json` (see `readConfigFile`).
 *   3. Neither — the caller falls back to interactive browser login.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dir = env.BELI_HOME ?? join(homedir(), ".beli");
  const configPath = env.BELI_CONFIG_PATH ?? join(dir, "config.json");

  const fromEnv = usableCreds({
    email: env.BELI_EMAIL,
    phone: env.BELI_PHONE,
    password: env.BELI_PASSWORD,
  });
  const resolved = fromEnv ?? usableCreds(readConfigFile(configPath)) ?? {};

  return {
    email: resolved.email,
    phone: resolved.phone,
    password: resolved.password,
    sessionPath: env.BELI_SESSION_PATH ?? join(dir, "session.json"),
    draftsPath: env.BELI_DRAFTS_PATH ?? join(dir, "drafts.json"),
    configPath,
    allowWrites: env.BELI_ALLOW_WRITES === "1" || env.BELI_ALLOW_WRITES === "true",
    minIntervalMs: Number(env.BELI_MIN_INTERVAL_MS ?? "350"),
    noBrowser: env.BELI_NO_BROWSER === "1" || env.BELI_NO_BROWSER === "true",
    probeOutputPath: env.BELI_PROBE_OUTPUT ?? join(process.cwd(), "probe-report.json"),
  };
}
