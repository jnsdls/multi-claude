import { describe, expect, test } from "bun:test";
import {
  accountIsUnknownForSelection,
  LIMIT_DEFAULT_TRUST_MS,
  limitApplies,
  limitClearedByReading,
  limitTrustedUntil,
  liveLimit,
} from "../src/limit.ts";
import { body, H, iso, limit, MIN, NOW, record } from "./harness/records.ts";

describe("limitApplies: scope", () => {
  const cases: [string, string | null, string | null, boolean][] = [
    ["five_hour bars every model", "five_hour", "claude-sonnet-4", true],
    ["seven_day bars every model", "seven_day", "claude-haiku-4", true],
    ["an unnamed Window bars every model", null, "claude-sonnet-4", true],
    ["a scoped Window bars its own model", "Opus", "claude-opus-4-1", true],
    ["case-insensitive", "opus", "CLAUDE-OPUS-4-1", true],
    ["a scoped Window leaves another model alone", "Opus", "claude-sonnet-4", false],
    ["a scoped Window bars an unknown model", "Opus", null, true],
  ];
  for (const [name, window, model, expected] of cases) {
    test(name, () => {
      expect(limitApplies(limit({ window }), model)).toBe(expected);
    });
  }
});

describe("limitTrustedUntil", () => {
  test("its own Reset when the hook named one", () => {
    const r = record({ id: "a", body: body({ sessionReset: iso(H) }) });
    expect(limitTrustedUntil(r, limit({ resetsAt: 3 * H }))).toBe(NOW + 3 * H);
  });
  test("else the earliest Reset in the Reading after the report", () => {
    const r = record({
      id: "a",
      body: body({ sessionReset: iso(-20 * MIN), weekReset: iso(50 * H), scoped: [["Opus", 10, iso(4 * H)]] }),
    });
    expect(limitTrustedUntil(r, limit({ reportedAt: -10 * MIN }))).toBe(NOW + 4 * H);
  });
  test("else 5 h from the report", () => {
    const r = record({ id: "a", body: null });
    expect(limitTrustedUntil(r, limit({ reportedAt: -10 * MIN }))).toBe(NOW - 10 * MIN + LIMIT_DEFAULT_TRUST_MS);
    const passed = record({ id: "b", body: body({ sessionReset: iso(-30 * MIN), weekReset: iso(-20 * MIN) }) });
    expect(limitTrustedUntil(passed, limit({ reportedAt: -10 * MIN }))).toBe(NOW - 10 * MIN + LIMIT_DEFAULT_TRUST_MS);
  });
});

describe("limitClearedByReading: early clear", () => {
  test("a Reading after the report showing the Window under 100 clears it", () => {
    const r = record({ id: "a", body: body({ session: 40 }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN, window: "five_hour" }))).toBe(true);
  });
  test("a Reading before the report does not", () => {
    const r = record({ id: "a", body: body({ session: 40 }), fetchedAt: -15 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN }))).toBe(false);
  });
  test("a Reading still showing the Window full does not", () => {
    const r = record({ id: "a", body: body({ session: 100 }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN }))).toBe(false);
  });
  test("a hollow Window carries no evidence (ADR 0007)", () => {
    const r = record({ id: "a", body: body({ session: 0, sessionReset: null }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN, resetsAt: 2 * H }))).toBe(false);
  });
  test("another Window under 100 says nothing about the named one", () => {
    const r = record({ id: "a", body: body({ session: 100, week: 10 }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN, window: "five_hour" }))).toBe(false);
  });
  test("a scoped Limit clears on its own Window", () => {
    const r = record({ id: "a", body: body({ session: 100, scoped: [["Opus", 30]] }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN, window: "Opus", resetsAt: 72 * H }))).toBe(true);
  });
  test("an unnamed Limit clears only when every evident Window is under 100", () => {
    const some = record({ id: "a", body: body({ session: 100, week: 10 }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(some, limit({ reportedAt: -10 * MIN, window: null }))).toBe(false);
    const all = record({ id: "b", body: body({ session: 60, week: 10 }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(all, limit({ reportedAt: -10 * MIN, window: null }))).toBe(true);
  });
  test("a name off the wall text (no Reset) is a label: the named Window open is not enough", () => {
    const r = record({ id: "a", body: body({ session: 40, scoped: [["Opus", 100]] }), fetchedAt: -5 * MIN });
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN, window: "five_hour", resetsAt: null }))).toBe(false);
    expect(limitClearedByReading(r, limit({ reportedAt: -10 * MIN, window: "five_hour", resetsAt: 2 * H }))).toBe(true);
  });
});

describe("liveLimit", () => {
  test("null with no Limit", () => {
    expect(liveLimit(record({ id: "a", body: body() }), null, NOW)).toBeNull();
  });
  test("live until its Reset", () => {
    const r = record({
      id: "a",
      body: body({ session: 100 }),
      fetchedAt: -15 * MIN,
      lastLimit: limit({ reportedAt: -10 * MIN, resetsAt: H }),
    });
    expect(liveLimit(r, "claude-sonnet-4", NOW)).not.toBeNull();
    expect(liveLimit(r, "claude-sonnet-4", NOW + H)).toBeNull();
  });
  test("not live for a model outside a scoped Window", () => {
    const r = record({
      id: "a",
      body: body({ scoped: [["Opus", 100]] }),
      fetchedAt: -15 * MIN,
      lastLimit: limit({ reportedAt: -10 * MIN, window: "Opus", resetsAt: H }),
    });
    expect(liveLimit(r, "claude-sonnet-4", NOW)).toBeNull();
    expect(liveLimit(r, "claude-opus-4-1", NOW)).not.toBeNull();
    expect(liveLimit(r, null, NOW)).not.toBeNull();
  });
  test("cleared early by evidence", () => {
    const r = record({
      id: "a",
      body: body({ session: 20 }),
      fetchedAt: -5 * MIN,
      lastLimit: limit({ reportedAt: -10 * MIN, resetsAt: H }),
    });
    expect(liveLimit(r, null, NOW)).toBeNull();
  });
  test("an unnamed Limit with no Reading is live for 5 h", () => {
    const r = record({ id: "a", body: null, lastLimit: limit({ reportedAt: -10 * MIN, window: null }) });
    expect(liveLimit(r, "claude-haiku-4", NOW)).not.toBeNull();
    expect(liveLimit(r, "claude-haiku-4", NOW + 5 * H)).toBeNull();
  });
});

describe("accountIsUnknownForSelection", () => {
  test("no Reading is Unknown", () => {
    expect(accountIsUnknownForSelection(record({ id: "a", body: null }), null, NOW)).toBe(true);
  });
  test("a standing Reading with no Limit is known", () => {
    expect(accountIsUnknownForSelection(record({ id: "a", body: body() }), null, NOW)).toBe(false);
  });
  test("an expired Limit with no clearing Reading leaves the Account Unknown, not free", () => {
    const r = record({
      id: "a",
      body: body({ session: 100 }),
      fetchedAt: -3 * H,
      lastLimit: limit({ reportedAt: -2 * H, resetsAt: -MIN }),
    });
    expect(liveLimit(r, null, NOW)).toBeNull();
    expect(accountIsUnknownForSelection(r, null, NOW)).toBe(true);
  });
  test("an expired Limit for another model does not", () => {
    const r = record({
      id: "a",
      body: body(),
      fetchedAt: -3 * H,
      lastLimit: limit({ reportedAt: -2 * H, window: "Opus", resetsAt: -MIN }),
    });
    expect(accountIsUnknownForSelection(r, "claude-sonnet-4", NOW)).toBe(false);
  });
  test("a Reading fetched after trust ended retires the Limit", () => {
    const r = record({
      id: "a",
      body: body({ session: 100 }),
      fetchedAt: -30_000,
      lastLimit: limit({ reportedAt: -2 * H, resetsAt: -MIN }),
    });
    expect(accountIsUnknownForSelection(r, null, NOW)).toBe(false);
  });
  test("a clearing Reading before the trust ended is known too", () => {
    const r = record({
      id: "a",
      body: body({ session: 30 }),
      fetchedAt: -90 * MIN,
      lastLimit: limit({ reportedAt: -2 * H, resetsAt: -MIN }),
    });
    expect(accountIsUnknownForSelection(r, null, NOW)).toBe(false);
  });
});
