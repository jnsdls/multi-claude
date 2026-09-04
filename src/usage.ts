// The usage Reading: one GET of the oauth usage endpoint per Account, the
// outcome written to the Record, the Refresh trigger run first when the token
// is inside its expiry margin. Nothing here ever marks an Account Exhausted.
import { needsLogin, readCredential, type OAuthCredential } from "./credential.ts";
import { accountDir } from "./paths.ts";
import { nowIso, readRecord, updateRecord, type AccountRecord, type LimitEntry, type UsageBody, type Window } from "./record.ts";
import { refreshDue, runRefreshTrigger, type RefreshOutcome } from "./refresh.ts";
import { VERSION } from "./version.ts";

export const USAGE_PATH = "/api/oauth/usage";
export const DEFAULT_USAGE_BASE = "https://api.anthropic.com";
export const OAUTH_BETA = "oauth-2025-04-20";
/** The scope the endpoint needs; setup-token and env-var logins lack it. */
export const PROFILE_SCOPE = "user:profile";

/** `Retry-After: 0` or none means the saturated edge: wait this long. */
export const BACKOFF_EDGE_MS = 300_000;
/** `Retry-After: N` is a deadline that a retry landing on it re-blocks; add this margin. */
export const BACKOFF_MARGIN_MS = 900_000;
export const BACKOFF_CAP_MS = 4_500_000;

/** The keys whose presence makes a 200 a real body rather than an in-band error. */
const KNOWN_KEYS = ["five_hour", "seven_day", "seven_day_oauth_apps", "seven_day_opus", "seven_day_sonnet", "cinder_cove", "extra_usage", "limits"];

export type UsageOutcome =
  | { kind: "ok"; body: UsageBody }
  | { kind: "hollow" }
  | { kind: "rate-limited"; backoffUntil: string; retryAfter: string | null }
  | { kind: "error"; reason: string }
  | { kind: "skipped"; reason: "needs-login" | "no-profile-scope" };

/** The endpoint base: production, or MCLAUDE_USAGE_URL for the test server. */
export function usageBase(): string {
  return (process.env.MCLAUDE_USAGE_URL || DEFAULT_USAGE_BASE).replace(/\/+$/, "");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseWindow(v: unknown): Window | null {
  if (!isObject(v)) return null;
  const utilization = typeof v.utilization === "number" ? v.utilization : null;
  const resets_at = typeof v.resets_at === "string" ? v.resets_at : null;
  return { utilization, resets_at };
}

function parseLimit(v: unknown): LimitEntry | null {
  if (!isObject(v) || typeof v.kind !== "string" || typeof v.percent !== "number") return null;
  const entry: LimitEntry = {
    kind: v.kind,
    percent: v.percent,
    resets_at: typeof v.resets_at === "string" ? v.resets_at : null,
  };
  if (typeof v.group === "string") entry.group = v.group;
  const model = isObject(v.scope) && isObject(v.scope.model) ? v.scope.model : null;
  if (model && typeof model.display_name === "string") {
    entry.scope = { model: { id: typeof model.id === "string" ? model.id : null, display_name: model.display_name } };
  }
  return entry;
}

/**
 * Keeps `five_hour`, `seven_day`, `limits[]` and the two credit flags; drops
 * everything else. Null when the object carries none of the known keys, which
 * Claude Code treats as an in-band error.
 */
export function normalizeBody(raw: unknown): UsageBody | null {
  if (!isObject(raw) || !KNOWN_KEYS.some((k) => k in raw)) return null;
  const extra = isObject(raw.extra_usage) ? raw.extra_usage : {};
  const limits = Array.isArray(raw.limits) ? raw.limits.map(parseLimit).filter((l): l is LimitEntry => l !== null) : [];
  return {
    five_hour: parseWindow(raw.five_hour),
    seven_day: parseWindow(raw.seven_day),
    limits,
    extra_usage: {
      is_enabled: extra.is_enabled === true,
      spend_limit_reached: typeof extra.spend_limit_reached === "boolean" ? extra.spend_limit_reached : null,
    },
  };
}

function windowIsHollow(w: Window | null): boolean {
  return !w || ((w.utilization ?? 0) === 0 && w.resets_at === null);
}

/** Every Window reads zero with no Reset, or there are no Windows at all. */
export function isHollowBody(body: UsageBody): boolean {
  const limitsHollow = body.limits.every((l) => l.percent === 0 && l.resets_at === null);
  return windowIsHollow(body.five_hour) && windowIsHollow(body.seven_day) && limitsHollow;
}

function resetAhead(resetsAt: string | null | undefined, now: number): boolean {
  if (!resetsAt) return false;
  const t = Date.parse(resetsAt);
  return !Number.isNaN(t) && t > now;
}

/** A fresh Window with no Reset carries no evidence and may not overwrite a stored Window whose Reset is still ahead. */
function mergeWindow(stored: Window | null | undefined, fresh: Window | null, now: number): Window | null {
  if (fresh && fresh.resets_at === null && stored && resetAhead(stored.resets_at, now)) return stored;
  return fresh;
}

function limitKey(l: LimitEntry): string {
  return `${l.kind}:${l.scope?.model?.display_name ?? ""}`;
}

/**
 * The per-Window hollow rule over a whole body: `fresh` wins except where it
 * carries a Window with no Reset and `stored` still has that Window open. Pure.
 */
export function mergeUsageBody(stored: UsageBody | null, fresh: UsageBody, now: number): UsageBody {
  if (!stored) return fresh;
  const storedLimits = new Map(stored.limits.map((l) => [limitKey(l), l]));
  return {
    five_hour: mergeWindow(stored.five_hour, fresh.five_hour, now),
    seven_day: mergeWindow(stored.seven_day, fresh.seven_day, now),
    limits: fresh.limits.map((l) => {
      const prev = storedLimits.get(limitKey(l));
      return l.resets_at === null && prev && resetAhead(prev.resets_at, now) ? prev : l;
    }),
    extra_usage: fresh.extra_usage,
  };
}

/** Absent or 0 means the saturated edge; N means a deadline plus margin. An HTTP date reads as absent. */
export function backoffFromRetryAfter(retryAfter: string | null, now: number): string {
  const n = retryAfter === null ? Number.NaN : Number(retryAfter.trim());
  const waitMs = Number.isFinite(n) && n > 0 ? Math.min(n * 1000 + BACKOFF_MARGIN_MS, BACKOFF_CAP_MS) : BACKOFF_EDGE_MS;
  return new Date(now + waitMs).toISOString();
}

export interface FetchUsageOptions {
  timeoutMs: number;
  version?: string;
  /** A credential already read for this Account, so the Keychain is not asked twice. */
  credential?: OAuthCredential | null;
  now?: number;
}

/** One GET of the usage endpoint for the Account in `dir`. Never throws. */
export async function fetchUsage(dir: string, opts: FetchUsageOptions): Promise<UsageOutcome> {
  const cred = opts.credential === undefined ? await readCredential(dir) : opts.credential;
  if (needsLogin(cred)) return { kind: "skipped", reason: "needs-login" };
  if (!cred!.scopes.includes(PROFILE_SCOPE)) return { kind: "skipped", reason: "no-profile-scope" };
  const now = opts.now ?? Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${usageBase()}${USAGE_PATH}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cred!.accessToken}`,
        "anthropic-beta": OAUTH_BETA,
        Accept: "application/json",
        "User-Agent": `mclaude/${opts.version ?? VERSION}`,
      },
    });
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      return { kind: "rate-limited", backoffUntil: backoffFromRetryAfter(retryAfter, now), retryAfter };
    }
    if (!res.ok) return { kind: "error", reason: `HTTP ${res.status}` };
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return { kind: "error", reason: "non-JSON body" };
    }
    const body = normalizeBody(raw);
    if (!body || isHollowBody(body)) return { kind: "hollow" };
    return { kind: "ok", body };
  } catch (e) {
    const timedOut = controller.signal.aborted;
    return { kind: "error", reason: timedOut ? `timeout after ${opts.timeoutMs} ms` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes an outcome into the Record under the write rule. Every attempt stamps
 * `lastAttemptAt`; only `ok` moves `lastGood` and `fetchedAt`; a 429 sets the
 * backoff. A skip is not an attempt. Null when the Record is gone.
 */
export function recordUsageOutcome(id: string, outcome: UsageOutcome, now: string = nowIso()): AccountRecord | null {
  if (outcome.kind === "skipped") return readRecord(id);
  const current = readRecord(id);
  if (!current) return null;
  return updateRecord(id, (latest) => {
    const rec = latest ?? current;
    const usage = { ...rec.usage, lastAttemptAt: now };
    if (outcome.kind === "ok") {
      usage.lastGood = mergeUsageBody(rec.usage.lastGood, outcome.body, Date.parse(now));
      usage.fetchedAt = now;
      usage.backoffUntil = null;
    } else if (outcome.kind === "rate-limited") {
      usage.backoffUntil = outcome.backoffUntil;
      usage.last429At = now;
    }
    return { ...rec, usage };
  });
}

export function inBackoff(record: AccountRecord, now: number): boolean {
  const until = record.usage.backoffUntil;
  if (!until) return false;
  const t = Date.parse(until);
  return !Number.isNaN(t) && t > now;
}

export interface PollOptions {
  timeoutMs: number;
  /** Where claude is, for the Refresh trigger. Null skips the trigger. */
  claudePath?: string | null;
  now?: number;
}

export interface PollResult {
  record: AccountRecord;
  /** The credential after any trigger ran; null when none could be read. */
  credential: OAuthCredential | null;
  /** Null when the Account was in backoff and nothing was tried. */
  outcome: UsageOutcome | null;
  refresh: RefreshOutcome | null;
}

/** Refresh trigger when due, then one fetch, then the Record write. Honours backoff. */
export async function pollAccount(record: AccountRecord, opts: PollOptions): Promise<PollResult> {
  const now = opts.now ?? Date.now();
  if (inBackoff(record, now)) return { record, credential: null, outcome: null, refresh: null };
  const dir = accountDir(record.id);
  let credential = await readCredential(dir);
  let refresh: RefreshOutcome | null = null;
  if (opts.claudePath && refreshDue(credential, now)) {
    const r = await runRefreshTrigger(opts.claudePath, dir, record.id, credential!);
    refresh = r.outcome;
    credential = r.credential;
  }
  const outcome = await fetchUsage(dir, { timeoutMs: opts.timeoutMs, credential, now });
  const written = recordUsageOutcome(record.id, outcome, new Date(now).toISOString());
  return { record: written ?? record, credential, outcome, refresh };
}

/** `pollAccount` over many Records with at most `concurrency` in flight. Results keep the input order. */
export async function pollMany(records: AccountRecord[], opts: PollOptions & { concurrency: number }): Promise<PollResult[]> {
  const results: PollResult[] = new Array(records.length);
  let next = 0;
  const worker = async () => {
    while (next < records.length) {
      const i = next++;
      results[i] = await pollAccount(records[i]!, opts);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, records.length)) }, worker));
  return results;
}

/** One stderr-ready line for an outcome that brought no Reading, or null when there is nothing to say. */
export function describeOutcome(alias: string, result: PollResult): string | null {
  if (result.refresh === "needs-login") return `${alias}: the refresh token was rejected; run \`mclaude account login ${alias}\``;
  const o = result.outcome;
  if (!o) return null;
  switch (o.kind) {
    case "ok":
      return null;
    case "hollow":
      return `${alias}: the usage endpoint sent an empty reading; keeping the last one`;
    case "rate-limited":
      return `${alias}: usage endpoint throttled; next try after ${o.backoffUntil}`;
    case "error":
      return `${alias}: usage fetch failed (${o.reason}); keeping the last reading`;
    case "skipped":
      return o.reason === "no-profile-scope" ? `${alias}: the token lacks the ${PROFILE_SCOPE} scope, so usage cannot be read` : null;
  }
}
