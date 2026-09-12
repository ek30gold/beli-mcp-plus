/**
 * Outbound-request safety rails.
 *
 * These exist because of a real incident: a debugging session drove this
 * client directly (bypassing the MCP server's `AppContext.throttle`, which is
 * the only throttle that used to exist), made several fresh logins in a few
 * minutes plus bursts of list reads, and the account was deactivated
 * server-side. The traffic pattern — repeated credential logins from a
 * non-app client, followed by bulk reads — is indistinguishable from
 * credential stuffing.
 *
 * The lesson is that a politeness throttle at the tool layer protects nothing:
 * any caller holding a `BeliClient` can skip it. So the limits live here, on
 * the client itself, where every outbound call must pass through them.
 *
 * Three separate protections, because they fail in different ways:
 *
 *  1. Pacing        — a minimum gap between outbound requests.
 *  2. Login budget  — logins are the expensive, suspicious operation. They are
 *                     capped per window, independently of ordinary requests.
 *  3. Circuit breaker — once the API signals an account-level problem, STOP.
 *                     In the incident, requests kept flowing after the first
 *                     "User is inactive", which is exactly the wrong response:
 *                     continuing to hammer an account that is already being
 *                     rejected can only deepen the problem.
 */

/** Thrown when the breaker has tripped. Never retry past this automatically. */
export class AccountLockoutError extends Error {
  constructor(readonly reason: string) {
    super(
      `Beli refused this account (${reason}). All further requests are blocked ` +
        `by the client to avoid making it worse. This is not a transient error: ` +
        `do not retry in a loop. Resolve the account state with Beli first, then ` +
        `construct a new client (or call resetGuard()).`,
    );
    this.name = "AccountLockoutError";
  }
}

/** Thrown when too many logins are attempted in one window. */
export class LoginBudgetError extends Error {
  constructor(max: number, windowMs: number) {
    super(
      `Refusing to log in: ${max} login(s) already attempted in the last ` +
        `${Math.round(windowMs / 1000)}s. Repeated credential logins look like ` +
        `credential stuffing and can get the account deactivated. Reuse the ` +
        `saved session (the refresh token) instead of logging in again.`,
    );
    this.name = "LoginBudgetError";
  }
}

/**
 * Default pacing, overridable by `BELI_MIN_INTERVAL_MS`.
 *
 * The env var exists so the test suite can run without real waiting (a 350ms
 * gap across a few hundred simulated requests would take minutes). Production
 * keeps the conservative default: opting OUT of pacing has to be deliberate.
 */
function defaultMinInterval(): number {
  const raw = typeof process !== "undefined" ? process.env?.BELI_MIN_INTERVAL_MS : undefined;
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 350;
}

export interface GuardOptions {
  /** Minimum gap between any two outbound requests. */
  minIntervalMs?: number;
  /** Max login calls allowed per `loginWindowMs`. */
  maxLoginsPerWindow?: number;
  /** Window over which logins are counted. */
  loginWindowMs?: number;
}

/**
 * Response signals that mean "this account is not welcome right now".
 *
 * Deliberately narrow. An ordinary 4xx (a bad category value, a missing
 * business) must NOT trip the breaker, or normal use becomes unusable — the
 * live API really does answer 500 for some valid-looking category codes. Only
 * account-level rejections belong here.
 */
function lockoutReason(status: number, body: string): string | null {
  if (status === 429) return "rate limited (HTTP 429)";
  if (status !== 401 && status !== 403) return null;
  const b = body.toLowerCase();
  if (b.includes("user_inactive") || b.includes("user is inactive")) {
    return "account inactive";
  }
  if (b.includes("no active account found")) {
    return "credentials rejected / account inactive";
  }
  if (b.includes("account disabled") || b.includes("suspended")) {
    return "account disabled";
  }
  return null;
}

export class RequestGuard {
  private lastRequestAt = 0;
  private loginTimes: number[] = [];
  private tripped: string | null = null;

  private readonly minIntervalMs: number;
  private readonly maxLoginsPerWindow: number;
  private readonly loginWindowMs: number;

  constructor(opts: GuardOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? defaultMinInterval();
    this.maxLoginsPerWindow = opts.maxLoginsPerWindow ?? 3;
    this.loginWindowMs = opts.loginWindowMs ?? 10 * 60 * 1000;
  }

  /** True once an account-level rejection has been seen. */
  get isTripped(): boolean {
    return this.tripped !== null;
  }

  get trippedReason(): string | null {
    return this.tripped;
  }

  /**
   * Clear the breaker. Deliberately explicit and never called automatically —
   * an operator who has resolved the account state opts back in by hand.
   */
  resetGuard(): void {
    this.tripped = null;
    this.loginTimes = [];
  }

  /** Gate + pace an ordinary outbound request. */
  async beforeRequest(now = Date.now(), sleep = defaultSleep): Promise<void> {
    if (this.tripped) throw new AccountLockoutError(this.tripped);
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Math.max(now, this.lastRequestAt + this.minIntervalMs);
  }

  /** Gate a login. Stricter than an ordinary request, and budgeted. */
  async beforeLogin(now = Date.now(), sleep = defaultSleep): Promise<void> {
    if (this.tripped) throw new AccountLockoutError(this.tripped);
    this.loginTimes = this.loginTimes.filter((t) => now - t < this.loginWindowMs);
    if (this.loginTimes.length >= this.maxLoginsPerWindow) {
      throw new LoginBudgetError(this.maxLoginsPerWindow, this.loginWindowMs);
    }
    this.loginTimes.push(now);
    await this.beforeRequest(now, sleep);
  }

  /**
   * Inspect every response. Trips the breaker on an account-level rejection so
   * the NEXT call fails locally instead of reaching Beli.
   */
  noteResponse(status: number, body: string): void {
    if (this.tripped) return;
    const reason = lockoutReason(status, body);
    if (reason) this.tripped = reason;
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
