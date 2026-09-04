import { describe, expect, test } from "bun:test";
import type { UsageBody } from "../src/record.ts";
import { backoffFromRetryAfter, isHollowBody, mergeUsageBody, normalizeBody } from "../src/usage.ts";

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const H = 3600_000;

const win = (utilization: number, resets_at: string | null) => ({ utilization, resets_at });
const scoped = (name: string, percent: number, resets_at: string | null) => ({
  kind: "weekly_scoped",
  percent,
  resets_at,
  scope: { model: { id: null, display_name: name } },
});
const body = (o: Partial<UsageBody>): UsageBody => ({
  five_hour: null,
  seven_day: null,
  limits: [],
  extra_usage: { is_enabled: false, spend_limit_reached: null },
  ...o,
});

describe("mergeUsageBody", () => {
  const stored = body({ five_hour: win(40, iso(2 * H)), seven_day: win(10, iso(72 * H)), limits: [scoped("Opus", 12, iso(72 * H))] });
  const cases: [string, UsageBody | null, UsageBody, UsageBody][] = [
    ["nothing stored: fresh as is", null, body({ five_hour: win(0, null) }), body({ five_hour: win(0, null) })],
    [
      "a fresh Window with a Reset overwrites",
      stored,
      body({ five_hour: win(45, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [scoped("Opus", 13, iso(72 * H))] }),
      body({ five_hour: win(45, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [scoped("Opus", 13, iso(72 * H))] }),
    ],
    [
      "a hollow session Window keeps the stored one whose Reset is ahead",
      stored,
      body({ five_hour: win(0, null), seven_day: win(11, iso(72 * H)), limits: [scoped("Opus", 13, iso(72 * H))] }),
      body({ five_hour: win(40, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [scoped("Opus", 13, iso(72 * H))] }),
    ],
    [
      "a hollow scoped Window keeps the stored entry",
      stored,
      body({ five_hour: win(45, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [scoped("Opus", 0, null)] }),
      body({ five_hour: win(45, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [scoped("Opus", 12, iso(72 * H))] }),
    ],
    [
      "a hollow Window overwrites a stored one whose Reset has passed",
      body({ five_hour: win(40, iso(-1)) }),
      body({ five_hour: win(0, null) }),
      body({ five_hour: win(0, null) }),
    ],
    [
      "a hollow Window overwrites a stored one with no Reset",
      body({ five_hour: win(40, null) }),
      body({ five_hour: win(0, null) }),
      body({ five_hour: win(0, null) }),
    ],
    [
      "a scoped entry the fresh body drops is gone",
      stored,
      body({ five_hour: win(45, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [] }),
      body({ five_hour: win(45, iso(2 * H)), seven_day: win(11, iso(72 * H)), limits: [] }),
    ],
    [
      "extra_usage always comes from fresh",
      stored,
      body({ five_hour: win(0, null), extra_usage: { is_enabled: true, spend_limit_reached: true } }),
      body({ five_hour: win(40, iso(2 * H)), extra_usage: { is_enabled: true, spend_limit_reached: true } }),
    ],
  ];
  for (const [name, s, fresh, expected] of cases) {
    test(name, () => {
      expect(mergeUsageBody(s, fresh, NOW)).toEqual(expected);
    });
  }
});

describe("normalizeBody", () => {
  test("keeps the four blocks and drops the rest", () => {
    const raw = {
      five_hour: { utilization: 29.0, resets_at: iso(H), limit_dollars: null, locked_reason: null },
      seven_day: { utilization: 7.0, resets_at: iso(72 * H) },
      seven_day_opus: null,
      nimbus_quill: { utilization: 0.0, resets_at: null },
      extra_usage: { is_enabled: false, monthly_limit: null, spend_limit_reached: false, daily: null },
      limits: [
        { kind: "session", group: "session", percent: 29, severity: "normal", resets_at: iso(H), scope: null, is_active: true },
        { kind: "weekly_scoped", group: "weekly", percent: 13, resets_at: iso(72 * H), scope: { model: { id: null, display_name: "Fable" }, surface: null } },
        { kind: "bogus" },
      ],
      spend: { used: {} },
      member_dashboard_available: false,
    };
    expect(normalizeBody(raw)).toEqual({
      five_hour: win(29, iso(H)),
      seven_day: win(7, iso(72 * H)),
      limits: [
        { kind: "session", group: "session", percent: 29, resets_at: iso(H) },
        { kind: "weekly_scoped", group: "weekly", percent: 13, resets_at: iso(72 * H), scope: { model: { id: null, display_name: "Fable" } } },
      ],
      extra_usage: { is_enabled: false, spend_limit_reached: false },
    });
  });
  test("none of the known keys is null; a non-object is null", () => {
    expect(normalizeBody({ error: { type: "rate_limit_error" } })).toBeNull();
    expect(normalizeBody({})).toBeNull();
    expect(normalizeBody("x")).toBeNull();
    expect(normalizeBody(null)).toBeNull();
    expect(normalizeBody([])).toBeNull();
  });
  test("a missing limits list is an empty one; missing extra_usage is disabled", () => {
    expect(normalizeBody({ five_hour: win(1, iso(H)) })).toEqual({ five_hour: win(1, iso(H)), seven_day: null, limits: [], extra_usage: { is_enabled: false, spend_limit_reached: null } });
  });
});

describe("isHollowBody", () => {
  const cases: [string, UsageBody, boolean][] = [
    ["all zero with no Reset", body({ five_hour: win(0, null), seven_day: win(0, null), limits: [scoped("Opus", 0, null)] }), true],
    ["no Windows at all", body({}), true],
    ["one real Window", body({ five_hour: win(0, null), seven_day: win(3, iso(H)) }), false],
    ["a real scoped Window only", body({ five_hour: win(0, null), limits: [scoped("Opus", 2, iso(H))] }), false],
    ["zero with a Reset is real", body({ five_hour: win(0, iso(H)) }), false],
  ];
  for (const [name, b, expected] of cases) {
    test(name, () => {
      expect(isHollowBody(b)).toBe(expected);
    });
  }
});

describe("backoffFromRetryAfter", () => {
  const cases: [string, string | null, number][] = [
    ["absent", null, 300],
    ["0", "0", 300],
    ["60", "60", 960],
    ["3600 hits the cap", "3600", 4500],
    ["an HTTP date reads as absent", "Wed, 21 Oct 2026 07:28:00 GMT", 300],
    ["negative reads as absent", "-5", 300],
  ];
  for (const [name, header, seconds] of cases) {
    test(name, () => {
      expect(backoffFromRetryAfter(header, NOW)).toBe(iso(seconds * 1000));
    });
  }
});
