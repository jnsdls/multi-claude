// In-memory Records for the pure-rule table tests. No disk, no clock: `NOW` is
// fixed and every timestamp is an offset from it.
import type { AccountRecord, LastLimit, UsageBody } from "../../src/record.ts";

export const NOW = Date.parse("2026-09-03T12:00:00.000Z");
export const H = 3600_000;
export const MIN = 60_000;
export const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

export interface BodyOptions {
  session?: number;
  week?: number;
  sessionReset?: string | null;
  weekReset?: string | null;
  scoped?: [name: string, percent: number, resetsAt?: string | null][];
  credits?: boolean;
  spendLimitReached?: boolean | null;
}

export function body(o: BodyOptions = {}): UsageBody {
  return {
    five_hour: { utilization: o.session ?? 10, resets_at: o.sessionReset === undefined ? iso(2 * H) : o.sessionReset },
    seven_day: { utilization: o.week ?? 5, resets_at: o.weekReset === undefined ? iso(72 * H) : o.weekReset },
    limits: (o.scoped ?? []).map(([name, percent, resetsAt]) => ({
      kind: "weekly_scoped",
      group: "weekly",
      percent,
      resets_at: resetsAt === undefined ? iso(72 * H) : resetsAt,
      scope: { model: { id: null, display_name: name } },
    })),
    extra_usage: {
      is_enabled: o.credits ?? false,
      spend_limit_reached: o.spendLimitReached === undefined ? false : o.spendLimitReached,
    },
  };
}

export interface RecordOptions {
  id: string;
  /** Offset of `addedAt` from NOW; defaults to the position in the call order. */
  addedAt?: number;
  disabled?: boolean;
  body?: UsageBody | null;
  /** Offset of `fetchedAt` from NOW; defaults to 1 min ago when a body is given. */
  fetchedAt?: number | null;
  lastAttemptAt?: number | null;
  backoffUntil?: number | null;
  lastLimit?: LastLimit | null;
}

let counter = 0;

export function record(o: RecordOptions): AccountRecord {
  const n = ++counter;
  const hasBody = o.body !== undefined && o.body !== null;
  const fetchedAt = o.fetchedAt === undefined ? (hasBody ? -MIN : null) : o.fetchedAt;
  const lastAttemptAt = o.lastAttemptAt === undefined ? fetchedAt : o.lastAttemptAt;
  return {
    version: 1,
    id: o.id,
    alias: o.id,
    addedAt: iso(o.addedAt ?? -100 * H + n * MIN),
    disabled: o.disabled ?? false,
    identity: {
      accountUuid: `acc-${o.id}`,
      organizationUuid: `org-${o.id}`,
      email: `${o.id}@example.com`,
      organizationName: "Example Org",
      subscriptionType: "max",
      capturedAt: iso(-100 * H),
    },
    usage: {
      lastGood: o.body ?? null,
      fetchedAt: fetchedAt === null ? null : iso(fetchedAt),
      lastAttemptAt: lastAttemptAt === null ? null : iso(lastAttemptAt),
      backoffUntil: o.backoffUntil === undefined || o.backoffUntil === null ? null : iso(o.backoffUntil),
      last429At: null,
    },
    lastLimit: o.lastLimit ?? null,
  };
}

export function limit(o: { reportedAt?: number; window?: string | null; resetsAt?: number | null } = {}): LastLimit {
  return {
    reportedAt: iso(o.reportedAt ?? -10 * MIN),
    sessionId: "session-1",
    window: o.window === undefined ? "five_hour" : o.window,
    resetsAt: o.resetsAt === undefined || o.resetsAt === null ? null : iso(o.resetsAt),
  };
}
