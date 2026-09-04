// Selection, Fallback and the candidate-refresh order, as pure functions over a
// set of Records. Session start and Handoff both call `select` with the same
// inputs (ADR 0007): the rule reads state, never position, so several sessions
// hitting one wall converge on the same target instead of cascading.
import { accountIsUnknownForSelection, limitTrustedUntil, liveLimit } from "./limit.ts";
import type { AccountRecord, LastLimit } from "./record.ts";
import { inBackoff } from "./usage.ts";
import { applicableWindows, CANDIDATE_CAP, isFresh, maxUtilization, tightestWindow, type NamedWindow } from "./windows.ts";

export interface SelectionInput {
  records: AccountRecord[];
  activeId: string | null;
  model: string | null;
  threshold: number;
  now: number;
}

export type Selection =
  /** The Active account keeps the launch. */
  | { kind: "stay"; id: string; record: AccountRecord }
  /** Another Account takes it (or there was no Active account). */
  | { kind: "move"; id: string; record: AccountRecord; from: string | null }
  /** Every eligible Account has no Headroom for the model. */
  | { kind: "exhausted" }
  /** No eligible Account at all: every Account is Disabled. */
  | { kind: "none" };

/** One Record measured against the model and the clock. */
export interface Assessment {
  record: AccountRecord;
  /** The Limit barring this model right now, if any. */
  limit: LastLimit | null;
  /** Max Utilization across the applicable Windows; null with no evidence. */
  utilization: number | null;
  tightest: NamedWindow | null;
  /** True when there is nothing to decide on and no live Limit. */
  unknown: boolean;
  /** The tightest Window reads full or a live Limit bars the model. */
  noHeadroom: boolean;
}

export function assess(record: AccountRecord, model: string | null, now: number): Assessment {
  const limit = liveLimit(record, model, now);
  const windows = applicableWindows(record.usage.lastGood, model, now);
  const utilization = maxUtilization(windows);
  const tightest = tightestWindow(windows);
  const unknown = limit === null && (utilization === null || accountIsUnknownForSelection(record, model, now));
  const noHeadroom = limit !== null || (!unknown && utilization !== null && utilization >= 100);
  return { record, limit, utilization, tightest, unknown, noHeadroom };
}

function byAddedAt(a: AccountRecord, b: AccountRecord): number {
  return Date.parse(a.addedAt) - Date.parse(b.addedAt) || a.id.localeCompare(b.id);
}

/** Lowest Utilization first, ties by the earliest Reset of the tightest Window, then addedAt. */
function byHeadroom(a: Assessment, b: Assessment): number {
  const ua = a.utilization ?? Number.POSITIVE_INFINITY;
  const ub = b.utilization ?? Number.POSITIVE_INFINITY;
  if (ua !== ub) return ua - ub;
  const ra = a.tightest ? Date.parse(a.tightest.resetsAt) : Number.POSITIVE_INFINITY;
  const rb = b.tightest ? Date.parse(b.tightest.resetsAt) : Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  return byAddedAt(a.record, b.record);
}

/**
 * Stay on the Active account unless it is Disabled, at or past the threshold,
 * barred by a live Limit for the model, or Unknown while a known Account is
 * under the threshold. When leaving: the known Account with the most Headroom
 * under the threshold; else an Unknown one, in addedAt order, so the launch is
 * the probe; else stay while the Active account has any Headroom; else any
 * known Account with Headroom; else Exhausted. Disabled Accounts are never chosen.
 */
export function select(input: SelectionInput): Selection {
  const { activeId, model, threshold, now } = input;
  const eligible = input.records.filter((r) => !r.disabled).sort(byAddedAt).map((r) => assess(r, model, now));
  if (eligible.length === 0) return { kind: "none" };

  const active = eligible.find((a) => a.record.id === activeId) ?? null;
  const known = eligible.filter((a) => !a.unknown && !a.noHeadroom).sort(byHeadroom);
  const qualifying = known.filter((a) => a.utilization! < threshold);
  const unknown = eligible.filter((a) => a.unknown);

  if (active) {
    const past = !active.unknown && !active.noHeadroom && active.utilization! >= threshold;
    const leave = active.noHeadroom || past || (active.unknown && qualifying.length > 0);
    if (!leave) return { kind: "stay", id: active.record.id, record: active.record };
  }

  const move = (a: Assessment): Selection =>
    a.record.id === activeId
      ? { kind: "stay", id: a.record.id, record: a.record }
      : { kind: "move", id: a.record.id, record: a.record, from: activeId };

  if (qualifying.length > 0) return move(qualifying[0]!);
  if (unknown.length > 0) return move(unknown[0]!);
  if (active && !active.noHeadroom) return { kind: "stay", id: active.record.id, record: active.record };
  if (known.length > 0) return move(known[0]!);
  return { kind: "exhausted" };
}

export type FallbackTier = "unknown" | "credits" | "reset";

export interface Fallback {
  record: AccountRecord;
  tier: FallbackTier;
  /** The Window that walls the Account, for the stderr line. Null on the Unknown tier. */
  window: string | null;
  /** When that wall lifts, as far as the Record says. */
  resetsAt: string | null;
}

/** The Window and Reset an Account waits on: its live Limit, else its tightest applicable Window. */
function wall(a: Assessment): { window: string | null; resetsAt: string | null } {
  if (a.limit) {
    const resetsAt = a.limit.resetsAt ?? new Date(limitTrustedUntil(a.record, a.limit)).toISOString();
    return { window: a.limit.window ?? a.tightest?.name ?? null, resetsAt };
  }
  return { window: a.tightest?.name ?? null, resetsAt: a.tightest?.resetsAt ?? null };
}

function hasCredits(record: AccountRecord): boolean {
  const extra = record.usage.lastGood?.extra_usage;
  return !!extra && extra.is_enabled === true && extra.spend_limit_reached !== true;
}

function byWallReset(a: Assessment, b: Assessment): number {
  const ra = wall(a).resetsAt;
  const rb = wall(b).resetsAt;
  const ta = ra ? Date.parse(ra) : Number.POSITIVE_INFINITY;
  const tb = rb ? Date.parse(rb) : Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return byAddedAt(a.record, b.record);
}

/**
 * The Account to launch on when Exhausted (ADR 0003): Unknown first in addedAt
 * order, then Credits enabled with the spend limit not reached (earliest Reset
 * breaks ties), then the Account whose wall lifts soonest. Disabled skipped.
 * Null when every Account is Disabled.
 */
export function fallback(records: AccountRecord[], model: string | null, now: number): Fallback | null {
  const eligible = records.filter((r) => !r.disabled).sort(byAddedAt).map((r) => assess(r, model, now));
  if (eligible.length === 0) return null;
  const unknown = eligible.find((a) => a.unknown);
  if (unknown) return { record: unknown.record, tier: "unknown", window: null, resetsAt: null };
  const credits = eligible.filter((a) => hasCredits(a.record)).sort(byWallReset);
  if (credits.length > 0) return { record: credits[0]!.record, tier: "credits", ...wall(credits[0]!) };
  const soonest = [...eligible].sort(byWallReset)[0]!;
  return { record: soonest.record, tier: "reset", ...wall(soonest) };
}

/** The earliest wall among eligible Accounts, for the `onExhausted=fail` line. Null when no Reset is known. */
export function earliestWall(records: AccountRecord[], model: string | null, now: number): { record: AccountRecord; window: string | null; resetsAt: string } | null {
  const walls = records
    .filter((r) => !r.disabled)
    .map((r) => ({ record: r, ...wall(assess(r, model, now)) }))
    .filter((w): w is { record: AccountRecord; window: string | null; resetsAt: string } => w.resetsAt !== null)
    .sort((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt) || byAddedAt(a.record, b.record));
  return walls[0] ?? null;
}

/**
 * Which Accounts to refresh when Selection has to leave, at most CANDIDATE_CAP:
 * Accounts with a Reading by cached Headroom, then Accounts never polled in
 * addedAt order, then Accounts whose last poll brought nothing in addedAt
 * order. The Active account was just handled; Disabled and backoff Accounts
 * are never probed, and a fresh Reading is not asked for again. A Needs login
 * Account may be among them; the poll skips it.
 */
export function refreshOrder(records: AccountRecord[], activeId: string | null, model: string | null, now: number): AccountRecord[] {
  const pool = records
    .filter((r) => r.id !== activeId && !r.disabled && !inBackoff(r, now) && !isFresh(r.usage, now))
    .sort(byAddedAt);
  const withReading = pool.filter((r) => r.usage.lastGood !== null).map((r) => assess(r, model, now)).sort(byHeadroom).map((a) => a.record);
  const neverPolled = pool.filter((r) => r.usage.lastGood === null && !r.usage.lastAttemptAt);
  const errored = pool.filter((r) => r.usage.lastGood === null && !!r.usage.lastAttemptAt);
  return [...withReading, ...neverPolled, ...errored].slice(0, CANDIDATE_CAP);
}
