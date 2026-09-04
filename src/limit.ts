// The last Limit an Account reported: the pure rules over it (which launches it
// bars, how long it is believed, what evidence clears it early) and the write
// path from a Signal to the Record, with the one usage request that names the
// Window (ADR 0007).
import type { Signal } from "./hook.ts";
import { readRecord, updateRecord, type AccountRecord, type LastLimit } from "./record.ts";
import { pollAccount } from "./usage.ts";
import { applicableWindows, evidentWindows, isUnknown, LAUNCH_TIMEOUT_MS, tightestWindow, type NamedWindow } from "./windows.ts";

/** With no Reset to go by, a Limit is believed this long after it was reported. */
export const LIMIT_DEFAULT_TRUST_MS = 5 * 3600_000;

const UNSCOPED = new Set(["five_hour", "seven_day"]);

/**
 * A session or weekly-all Limit bars every model, as does one whose Window is
 * not yet known. A scoped Limit bars only launches whose Requested model matches
 * it, by the same substring rule scoped Windows use; an unknown model matches.
 */
export function limitApplies(limit: LastLimit, model: string | null): boolean {
  if (limit.window === null || UNSCOPED.has(limit.window)) return true;
  if (model === null) return true;
  return model.toLowerCase().includes(limit.window.toLowerCase());
}

function parse(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : Number.NaN;
}

/**
 * The instant trust in the Limit ends: its own Reset when the hook named one,
 * else the earliest Reset in the Reading that is after the report, else 5 h
 * after the report.
 */
export function limitTrustedUntil(record: Pick<AccountRecord, "usage">, limit: LastLimit): number {
  const reported = parse(limit.reportedAt);
  const own = parse(limit.resetsAt);
  if (!Number.isNaN(own)) return own;
  let earliest = Number.NaN;
  for (const w of evidentWindows(record.usage.lastGood, reported)) {
    const t = parse(w.resetsAt);
    if (Number.isNaN(earliest) || t < earliest) earliest = t;
  }
  return Number.isNaN(earliest) ? reported + LIMIT_DEFAULT_TRUST_MS : earliest;
}

function sameWindow(w: NamedWindow, name: string): boolean {
  return w.name.toLowerCase() === name.toLowerCase();
}

/**
 * Early clear (ADR 0007): only a Reading fetched after the report, carrying a
 * Window with a Reset, that shows the named Window under 100. A hollow
 * response never clears. A Limit the poll did not name (no Reset: unnamed, or
 * named off the wall text alone) clears only when every evident Window in
 * such a Reading reads under 100.
 */
export function limitClearedByReading(record: Pick<AccountRecord, "usage">, limit: LastLimit): boolean {
  const reported = parse(limit.reportedAt);
  const fetched = parse(record.usage.fetchedAt);
  if (Number.isNaN(fetched) || !(fetched > reported)) return false;
  const windows = evidentWindows(record.usage.lastGood, reported);
  if (windows.length === 0) return false;
  if (limit.window === null || limit.resetsAt === null) return windows.every((w) => w.utilization < 100);
  const named = windows.filter((w) => sameWindow(w, limit.window!));
  return named.length > 0 && named.every((w) => w.utilization < 100);
}

/**
 * The Limit that bars a launch of `model` right now, or null. Live means: it
 * applies to the model, trust in it has not ended, and no later Reading has
 * shown the Window open.
 */
export function liveLimit(record: Pick<AccountRecord, "usage" | "lastLimit">, model: string | null, now: number): LastLimit | null {
  const limit = record.lastLimit;
  if (!limit || !limitApplies(limit, model)) return null;
  if (limitClearedByReading(record, limit)) return null;
  if (now >= limitTrustedUntil(record, limit)) return null;
  return limit;
}

/**
 * A Limit whose trust has ended without a clearing Reading leaves the Account
 * Unknown, not free: nothing has shown the Window open. A Reading fetched after
 * trust ended retires the Limit and speaks for itself.
 */
export function limitLeavesUnknown(record: Pick<AccountRecord, "usage" | "lastLimit">, model: string | null, now: number): boolean {
  const limit = record.lastLimit;
  if (!limit || !limitApplies(limit, model)) return false;
  if (limitClearedByReading(record, limit)) return false;
  const until = limitTrustedUntil(record, limit);
  if (now < until) return false;
  const fetched = parse(record.usage.fetchedAt);
  return !(fetched > until);
}

/** Unknown for Selection: no Reading to decide on, or a Limit whose trust ended without evidence either way. */
export function accountIsUnknownForSelection(record: Pick<AccountRecord, "usage" | "lastLimit">, model: string | null, now: number): boolean {
  return isUnknown(record, now) || limitLeavesUnknown(record, model, now);
}

/**
 * The Window a wall text names, as a best effort: `session limit` is
 * `five_hour`, `weekly limit` is `seven_day`, and `<Name> limit` with a
 * capitalised name (Opus, Sonnet, Fable) is that scoped display name. Anything
 * else (`usage limit`, `monthly spend limit`, no text) is null. A label for
 * when the poll brings nothing, never evidence.
 */
export function windowFromWallText(text: string | undefined): string | null {
  if (!text) return null;
  const m = /\byour (session|weekly|[A-Z][A-Za-z0-9.-]*) limit\b/.exec(text);
  if (!m) return null;
  if (m[1] === "session") return "five_hour";
  if (m[1] === "weekly") return "seven_day";
  return m[1]!;
}

/**
 * The Limit a `StopFailure` Signal reports. Pure. `reportedAt` is when the hook
 * received it and the session id comes from the payload (or the tracked one
 * when the payload lacks it). Neither the Window nor the Reset is in the
 * payload; the post-Limit usage request names them.
 */
export function limitFromSignal(payload: Record<string, unknown>, receivedAt: string, fallbackSessionId = ""): LastLimit {
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : fallbackSessionId;
  return { reportedAt: receivedAt, sessionId, window: null, resetsAt: null };
}

function wallText(payload: Record<string, unknown>): string | undefined {
  return typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : undefined;
}

/**
 * The Window a Reading blames for a Limit hit under `model`: the applicable
 * Window reading 100, else the highest evident one. Null with no evident Window.
 */
export function windowBlamed(record: Pick<AccountRecord, "usage">, model: string | null, now: number): NamedWindow | null {
  const full = applicableWindows(record.usage.lastGood, model, now).find((w) => w.utilization >= 100);
  return full ?? tightestWindow(evidentWindows(record.usage.lastGood, now));
}

function fetchedAfter(record: Pick<AccountRecord, "usage">, iso: string): boolean {
  const fetched = parse(record.usage.fetchedAt);
  return !Number.isNaN(fetched) && fetched > parse(iso);
}

function nameLimit(accountId: string, fallback: AccountRecord, window: string | null, resetsAt: string | null): AccountRecord {
  return updateRecord(accountId, (latest) => {
    const rec = latest ?? fallback;
    return rec.lastLimit ? { ...rec, lastLimit: { ...rec.lastLimit, window, resetsAt } } : rec;
  });
}

/**
 * Writes the Limit a Signal reports to the Account's Record, then makes one
 * usage request to name the Window and its Reset. The request is skipped when a
 * Reading fetched after the report already exists (it names the Window), or
 * when the Record holds a live Limit that a later Reading already confirmed;
 * its Window and Reset then carry over. Several sessions on one Account hit
 * the wall within seconds, and the first one's request serves them all (ADR
 * 0007). When the request brings nothing, the wall text supplies a name and no
 * Reset. Null when the Record is gone.
 */
export async function recordLimit(
  accountId: string,
  signal: Signal,
  opts: { now?: number; claudePath?: string | null; fallbackSessionId?: string; model?: string | null } = {},
): Promise<AccountRecord | null> {
  const now = opts.now ?? Date.now();
  const model = opts.model ?? null;
  const current = readRecord(accountId);
  if (!current) return null;
  const reported = limitFromSignal(signal.payload, signal.receivedAt, opts.fallbackSessionId);
  const prior = liveLimit(current, null, now);
  const confirmed = prior && fetchedAfter(current, prior.reportedAt) ? prior : null;
  const carried: LastLimit = confirmed ? { ...reported, window: confirmed.window, resetsAt: confirmed.resetsAt } : reported;
  let record = updateRecord(accountId, (latest) => ({ ...(latest ?? current), lastLimit: carried }));
  if (confirmed) return record;

  if (!fetchedAfter(record, reported.reportedAt)) {
    const result = await pollAccount(record, { timeoutMs: LAUNCH_TIMEOUT_MS, claudePath: opts.claudePath, now });
    record = result.record;
    if (result.outcome?.kind !== "ok") return nameLimit(accountId, record, windowFromWallText(wallText(signal.payload)), null);
  }
  const blamed = windowBlamed(record, model, now);
  if (!blamed) return nameLimit(accountId, record, windowFromWallText(wallText(signal.payload)), null);
  return nameLimit(accountId, record, blamed.name, blamed.resetsAt);
}
