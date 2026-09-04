import { describe, expect, test } from "bun:test";
import type { UsageBody } from "../src/record.ts";
import {
  ACTIVE_STALE_MS,
  applicableWindows,
  CANDIDATE_CAP,
  CANDIDATE_CONCURRENCY,
  earliestReset,
  FRESH_MS,
  isFresh,
  isUnknown,
  LAUNCH_TIMEOUT_MS,
  LIST_CONCURRENCY,
  LIST_TIMEOUT_MS,
  maxUtilization,
  readingStands,
  tightestWindow,
} from "../src/windows.ts";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const H = 3600_000;

function body(o: { session?: number; week?: number; sessionReset?: string | null; weekReset?: string | null; scoped?: [string, number, string | null][] } = {}): UsageBody {
  return {
    five_hour: { utilization: o.session ?? 30, resets_at: o.sessionReset === undefined ? iso(2 * H) : o.sessionReset },
    seven_day: { utilization: o.week ?? 10, resets_at: o.weekReset === undefined ? iso(72 * H) : o.weekReset },
    limits: (o.scoped ?? []).map(([name, percent, resets_at]) => ({
      kind: "weekly_scoped",
      group: "weekly",
      percent,
      resets_at,
      scope: { model: { id: null, display_name: name } },
    })),
    extra_usage: { is_enabled: false },
  };
}

const usage = (o: Partial<{ lastGood: UsageBody | null; fetchedAt: string | null; lastAttemptAt: string | null }>) => ({
  lastGood: null,
  fetchedAt: null,
  lastAttemptAt: null,
  backoffUntil: null,
  last429At: null,
  ...o,
});

describe("constants", () => {
  test("the polling schedule numbers", () => {
    expect([FRESH_MS, LAUNCH_TIMEOUT_MS, LIST_TIMEOUT_MS, ACTIVE_STALE_MS]).toEqual([180_000, 3_000, 5_000, 600_000]);
    expect([CANDIDATE_CAP, CANDIDATE_CONCURRENCY, LIST_CONCURRENCY]).toEqual([8, 4, 8]);
  });
});

describe("applicableWindows", () => {
  const b = body({ scoped: [["Opus", 40, iso(72 * H)], ["Sonnet", 5, iso(72 * H)]] });
  const cases: [string, string | null, string[]][] = [
    ["unscoped only for a model no scoped Window names", "claude-haiku-4", ["five_hour", "seven_day"]],
    ["the scoped Window whose name is in the model string", "claude-opus-4-1", ["five_hour", "seven_day", "Opus"]],
    ["case-insensitive", "CLAUDE-SONNET-4", ["five_hour", "seven_day", "Sonnet"]],
    ["null model means every scoped Window applies", null, ["five_hour", "seven_day", "Opus", "Sonnet"]],
  ];
  for (const [name, model, expected] of cases) {
    test(name, () => {
      expect(applicableWindows(b, model).map((w) => w.name)).toEqual(expected);
    });
  }
  test("a Window with no Reset carries no evidence and is left out", () => {
    const hollow = body({ sessionReset: null, scoped: [["Opus", 0, null]] });
    expect(applicableWindows(hollow, null).map((w) => w.name)).toEqual(["seven_day"]);
  });
  test("a null body has no Windows", () => {
    expect(applicableWindows(null, null)).toEqual([]);
  });
  test("a scoped entry of another kind or without a display name is ignored", () => {
    const b2: UsageBody = { ...body(), limits: [{ kind: "weekly_all", percent: 99, resets_at: iso(H), scope: null }, { kind: "weekly_scoped", percent: 50, resets_at: iso(H), scope: { model: null } }] };
    expect(applicableWindows(b2, null).map((w) => w.name)).toEqual(["five_hour", "seven_day"]);
  });
});

describe("maxUtilization, tightestWindow, earliestReset", () => {
  test("empty", () => {
    expect(maxUtilization([])).toBeNull();
    expect(tightestWindow([])).toBeNull();
    expect(earliestReset([])).toBeNull();
  });
  test("the highest Utilization binds", () => {
    const w = applicableWindows(body({ session: 30, week: 55, scoped: [["Opus", 40, iso(72 * H)]] }), null);
    expect(maxUtilization(w)).toBe(55);
    expect(tightestWindow(w)!.name).toBe("seven_day");
    expect(earliestReset(w)).toBe(iso(2 * H));
  });
  test("a tie goes to the earliest Reset", () => {
    const w = applicableWindows(body({ session: 50, week: 50, sessionReset: iso(5 * H), weekReset: iso(H) }), null);
    expect(tightestWindow(w)!.name).toBe("seven_day");
  });
});

describe("isFresh", () => {
  const cases: [string, string | null, boolean][] = [
    ["no fetch", null, false],
    ["10 s ago", iso(-10_000), true],
    ["179 s ago", iso(-179_000), true],
    ["180 s ago", iso(-180_000), false],
    ["garbage", "not a date", false],
  ];
  for (const [name, fetchedAt, expected] of cases) {
    test(name, () => {
      expect(isFresh(usage({ fetchedAt }), NOW)).toBe(expected);
    });
  }
});

describe("readingStands", () => {
  test("no Reading does not stand", () => {
    expect(readingStands(usage({}), NOW)).toBe(false);
  });
  test("every Reset ahead", () => {
    expect(readingStands(usage({ lastGood: body() }), NOW)).toBe(true);
  });
  test("one passed Reset ends it", () => {
    expect(readingStands(usage({ lastGood: body({ sessionReset: iso(-1) }) }), NOW)).toBe(false);
  });
  test("a passed scoped Reset also ends it", () => {
    expect(readingStands(usage({ lastGood: body({ scoped: [["Opus", 10, iso(-H)]] }) }), NOW)).toBe(false);
  });
  test("Windows with no Reset do not count against it", () => {
    expect(readingStands(usage({ lastGood: body({ sessionReset: null }) }), NOW)).toBe(true);
  });
});

describe("isUnknown", () => {
  const passed = body({ sessionReset: iso(-H) });
  const cases: [string, ReturnType<typeof usage>, boolean][] = [
    ["no Reading at all", usage({}), true],
    ["a Reading that stands", usage({ lastGood: body(), fetchedAt: iso(-3 * H), lastAttemptAt: iso(-3 * H) }), false],
    ["a passed Reset with no attempt since is stale, not Unknown", usage({ lastGood: passed, fetchedAt: iso(-3 * H), lastAttemptAt: iso(-3 * H) }), false],
    ["a passed Reset and a failed attempt since", usage({ lastGood: passed, fetchedAt: iso(-3 * H), lastAttemptAt: iso(-10_000) }), true],
    ["a passed Reset and a fetch since (the body still carries the old Reset)", usage({ lastGood: passed, fetchedAt: iso(-10_000), lastAttemptAt: iso(-10_000) }), false],
  ];
  for (const [name, u, expected] of cases) {
    test(name, () => {
      expect(isUnknown({ usage: u }, NOW)).toBe(expected);
    });
  }
});
