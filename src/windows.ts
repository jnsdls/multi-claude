// Pure rules over a Reading: which Windows apply to a model, which one binds,
// whether the Reading is fresh, still stands, or leaves the Account Unknown.
import type { AccountRecord, Usage, UsageBody } from "./record.ts";

/** A Reading younger than this decides without a new request. */
export const FRESH_MS = 180_000;
/** The usage request budget at a Session start or Handoff. */
export const LAUNCH_TIMEOUT_MS = 3_000;
/** The usage request budget for `list --refresh` and `add`. */
export const LIST_TIMEOUT_MS = 5_000;
/** Past this age the Active account gets one request at a Session start. */
export const ACTIVE_STALE_MS = 600_000;
/** Selection refreshes at most this many candidates when it has to leave. */
export const CANDIDATE_CAP = 8;
export const CANDIDATE_CONCURRENCY = 4;
export const LIST_CONCURRENCY = 8;

/** One Window with its name: `five_hour`, `seven_day`, or a scoped model display name. */
export interface NamedWindow {
  name: string;
  utilization: number;
  resetsAt: string;
  scoped: boolean;
}

/** Every Window in the body that has a Reset, whether or not that Reset has passed. */
function namedWindows(body: UsageBody | null): NamedWindow[] {
  if (!body) return [];
  const out: NamedWindow[] = [];
  for (const name of ["five_hour", "seven_day"] as const) {
    const w = body[name];
    if (w && w.resets_at && w.utilization !== null && w.utilization !== undefined) {
      out.push({ name, utilization: w.utilization, resetsAt: w.resets_at, scoped: false });
    }
  }
  for (const l of body.limits ?? []) {
    const display = l.scope?.model?.display_name;
    if (l.kind !== "weekly_scoped" || !display || !l.resets_at) continue;
    out.push({ name: display, utilization: l.percent, resetsAt: l.resets_at, scoped: true });
  }
  return out;
}

function resetAhead(w: NamedWindow, now: number): boolean {
  const t = Date.parse(w.resetsAt);
  return !Number.isNaN(t) && t > now;
}

/**
 * Every Window in the body that carries evidence at `now`, whether or not it
 * applies to a model. A Window with no `resets_at` has not started (or the
 * endpoint sent a hollow placeholder), and one whose Reset has passed reads a
 * Utilization that is no longer true; neither counts for anything.
 */
export function evidentWindows(body: UsageBody | null, now: number): NamedWindow[] {
  return namedWindows(body).filter((w) => resetAhead(w, now));
}

/** Unscoped Windows always apply; a scoped one when its display name is inside the model string; a null model takes every scoped one. */
function appliesTo(w: NamedWindow, model: string | null): boolean {
  return !w.scoped || model === null || model.toLowerCase().includes(w.name.toLowerCase());
}

/** The evident Windows that count toward Headroom for `model`. */
export function applicableWindows(body: UsageBody | null, model: string | null, now: number): NamedWindow[] {
  return evidentWindows(body, now).filter((w) => appliesTo(w, model));
}

/** Highest Utilization among the Windows, or null when there are none. */
export function maxUtilization(windows: NamedWindow[]): number | null {
  if (windows.length === 0) return null;
  return Math.max(...windows.map((w) => w.utilization));
}

/** The Window with the highest Utilization; ties go to the earliest Reset. */
export function tightestWindow(windows: NamedWindow[]): NamedWindow | null {
  let best: NamedWindow | null = null;
  for (const w of windows) {
    if (!best || w.utilization > best.utilization) best = w;
    else if (w.utilization === best.utilization && Date.parse(w.resetsAt) < Date.parse(best.resetsAt)) best = w;
  }
  return best;
}

/** The soonest Reset among the Windows, or null when there are none. */
export function earliestReset(windows: NamedWindow[]): string | null {
  let best: string | null = null;
  for (const w of windows) {
    if (best === null || Date.parse(w.resetsAt) < Date.parse(best)) best = w.resetsAt;
  }
  return best;
}

export function isFresh(usage: Usage, now: number): boolean {
  if (!usage.fetchedAt) return false;
  const t = Date.parse(usage.fetchedAt);
  return !Number.isNaN(t) && now - t < FRESH_MS;
}

/** A Reading stands for `model` while it has an applicable Window and every applicable Reset is in the future. */
export function readingStands(usage: Usage, model: string | null, now: number): boolean {
  const windows = namedWindows(usage.lastGood).filter((w) => appliesTo(w, model));
  return windows.length > 0 && windows.every((w) => resetAhead(w, now));
}

/**
 * Unknown: nothing to decide on. No Reading was ever taken, or every Window in
 * the last one has passed its Reset. Whether a fetch was tried since makes no
 * difference; the Reading is trusted until a Reset in it passes and not after.
 */
export function isUnknown(record: Pick<AccountRecord, "usage">, now: number): boolean {
  return evidentWindows(record.usage.lastGood, now).length === 0;
}
