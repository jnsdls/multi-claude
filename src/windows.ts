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

/**
 * Every Window in the body that carries evidence, whether or not it applies to
 * a model. A Window with no `resets_at` has not started (or the endpoint sent a
 * hollow placeholder) and counts for nothing.
 */
export function evidentWindows(body: UsageBody | null): NamedWindow[] {
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

/**
 * The Windows that count toward Headroom for `model`. Unscoped Windows always
 * apply; a scoped one applies when its lower-cased display name is a substring
 * of the lower-cased model string. A null model means every scoped Window applies.
 */
export function applicableWindows(body: UsageBody | null, model: string | null): NamedWindow[] {
  const lower = model?.toLowerCase() ?? null;
  return evidentWindows(body).filter((w) => !w.scoped || lower === null || lower.includes(w.name.toLowerCase()));
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

/** Every Reset the Reading carries, evident or not. */
function resetsIn(body: UsageBody | null): number[] {
  if (!body) return [];
  const out: number[] = [];
  for (const w of [body.five_hour, body.seven_day, ...(body.limits ?? [])]) {
    if (!w?.resets_at) continue;
    const t = Date.parse(w.resets_at);
    if (!Number.isNaN(t)) out.push(t);
  }
  return out;
}

export function isFresh(usage: Usage, now: number): boolean {
  if (!usage.fetchedAt) return false;
  const t = Date.parse(usage.fetchedAt);
  return !Number.isNaN(t) && now - t < FRESH_MS;
}

/** A Reading stands while every Reset it carries is in the future. */
export function readingStands(usage: Usage, now: number): boolean {
  if (!usage.lastGood) return false;
  return resetsIn(usage.lastGood).every((t) => t > now);
}

/**
 * Unknown: no Reading at all, or a Reset in the last one has passed and the
 * attempt made since then brought nothing back (`lastAttemptAt` is after that
 * Reset and `fetchedAt` is not). A passed Reset with no attempt since is stale,
 * not Unknown.
 */
export function isUnknown(record: Pick<AccountRecord, "usage">, now: number): boolean {
  const usage = record.usage;
  if (!usage.lastGood) return true;
  const attempt = usage.lastAttemptAt ? Date.parse(usage.lastAttemptAt) : Number.NaN;
  const fetched = usage.fetchedAt ? Date.parse(usage.fetchedAt) : Number.NaN;
  for (const reset of resetsIn(usage.lastGood)) {
    if (reset > now) continue;
    if (attempt > reset && !(fetched > reset)) return true;
  }
  return false;
}
