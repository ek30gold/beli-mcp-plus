import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import {
  emptySession,
  type PersistedSession,
  type SessionState,
  type SessionStore,
} from "@beli/client";

/**
 * Persists ONLY the Beli refresh token to a 0600 JSON file so one login lasts
 * ~7 days (until the refresh token expires) across server restarts. The
 * access token, user id and access-token expiry are intentionally NOT written
 * to disk (see `PersistedSession`) — they're cheap to re-derive from one
 * refresh call — and the password is never written to disk at all (it never
 * enters `SessionState` in the first place).
 *
 * Writes are atomic (temp file + rename) so concurrent writers and a separate
 * `beli-mcp login` process can't observe or produce a half-written file, and so
 * permissions are always 0600 even if a prior file existed with looser modes.
 */
export class FileSessionStore implements SessionStore {
  constructor(private readonly path: string) {}

  async load(): Promise<SessionState> {
    try {
      const raw = await readFile(this.path, "utf8");
      const persisted = JSON.parse(raw) as Partial<PersistedSession>;
      return { ...emptySession(), refresh: persisted.refresh ?? null };
    } catch {
      return emptySession();
    }
  }

  async save(state: SessionState): Promise<void> {
    const persisted: PersistedSession = { refresh: state.refresh };
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(persisted, null, 2), { mode: 0o600 });
    await rename(tmp, this.path); // atomic; final file inherits tmp's 0600 mode
    await chmod(this.path, 0o600).catch(() => {});
  }
}
