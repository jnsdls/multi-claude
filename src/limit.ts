// Pure rules over the last Limit an Account reported: which launches it bars
// (scope), how long it is believed (trust), and what evidence clears it early.
// Nothing here writes a Limit; the Signal path does that.
import type { AccountRecord, LastLimit } from "./record.ts";
import { evidentWindows, isUnknown, type NamedWindow } from "./windows.ts";

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
  for (const w of evidentWindows(record.usage.lastGood)) {
    const t = parse(w.resetsAt);
    if (Number.isNaN(t) || !(t > reported)) continue;
    if (Number.isNaN(earliest) || t < earliest) earliest = t;
  }
  return Number.isNaN(earliest) ? reported + LIMIT_DEFAULT_TRUST_MS : earliest;
}

function sameWindow(w: NamedWindow, name: string): boolean {
  return w.name === name || w.name.toLowerCase() === name.toLowerCase();
}

/**
 * Early clear (ADR 0007): only a Reading fetched after the report, carrying a
 * Window with a Reset, that shows the named Window under 100. A hollow
 * response never clears. An unnamed Limit clears only when every evident
 * Window in such a Reading reads under 100.
 */
export function limitClearedByReading(record: Pick<AccountRecord, "usage">, limit: LastLimit): boolean {
  const fetched = parse(record.usage.fetchedAt);
  if (Number.isNaN(fetched) || !(fetched > parse(limit.reportedAt))) return false;
  const windows = evidentWindows(record.usage.lastGood);
  if (windows.length === 0) return false;
  if (limit.window === null) return windows.every((w) => w.utilization < 100);
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
