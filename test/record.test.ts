import { describe, expect, test } from "bun:test";
import { mergeRecord, parseRecord, type AccountRecord } from "../src/record.ts";

function rec(o: Partial<AccountRecord> = {}): AccountRecord {
  return {
    version: 1,
    id: "abc",
    alias: "a",
    addedAt: "2026-01-01T00:00:00.000Z",
    disabled: false,
    identity: {
      accountUuid: "u",
      organizationUuid: "o",
      email: "e",
      organizationName: "n",
      subscriptionType: "max",
      capturedAt: "2026-01-01T00:00:00.000Z",
    },
    usage: { lastGood: null, fetchedAt: null, lastAttemptAt: null, backoffUntil: null, last429At: null },
    lastLimit: null,
    ...o,
  };
}

const body = (n: number) => ({
  five_hour: { utilization: n, resets_at: null },
  seven_day: null,
  limits: [],
  extra_usage: { is_enabled: false },
});

describe("mergeRecord", () => {
  test("next wins when current is absent", () => {
    const n = rec({ alias: "b" });
    expect(mergeRecord(null, n)).toEqual(n);
  });
  test("a newer fetchedAt is kept over an older one", () => {
    const current = rec({
      usage: {
        lastGood: body(50),
        fetchedAt: "2026-01-01T00:10:00.000Z",
        lastAttemptAt: null,
        backoffUntil: null,
        last429At: null,
      },
    });
    const next = rec({
      alias: "renamed",
      usage: {
        lastGood: body(10),
        fetchedAt: "2026-01-01T00:05:00.000Z",
        lastAttemptAt: "x",
        backoffUntil: null,
        last429At: null,
      },
    });
    const merged = mergeRecord(current, next);
    expect(merged.alias).toBe("renamed");
    expect(merged.usage.lastGood).toEqual(body(50));
    expect(merged.usage.fetchedAt).toBe("2026-01-01T00:10:00.000Z");
    expect(merged.usage.lastAttemptAt).toBe("x");
  });
  test("a newer reading replaces an older one", () => {
    const current = rec({
      usage: {
        lastGood: body(50),
        fetchedAt: "2026-01-01T00:05:00.000Z",
        lastAttemptAt: null,
        backoffUntil: null,
        last429At: null,
      },
    });
    const next = rec({
      usage: {
        lastGood: body(60),
        fetchedAt: "2026-01-01T00:10:00.000Z",
        lastAttemptAt: null,
        backoffUntil: null,
        last429At: null,
      },
    });
    expect(mergeRecord(current, next).usage.lastGood).toEqual(body(60));
  });
  test("a next with no reading never clears a current reading", () => {
    const current = rec({
      usage: {
        lastGood: body(50),
        fetchedAt: "2026-01-01T00:05:00.000Z",
        lastAttemptAt: null,
        backoffUntil: null,
        last429At: null,
      },
    });
    const merged = mergeRecord(current, rec({ alias: "z" }));
    expect(merged.usage.lastGood).toEqual(body(50));
    expect(merged.alias).toBe("z");
  });
  test("an older reportedAt never replaces a Limit", () => {
    const current = rec({
      lastLimit: { reportedAt: "2026-01-01T01:00:00.000Z", sessionId: "s1", window: "five_hour", resetsAt: null },
    });
    const next = rec({
      lastLimit: { reportedAt: "2026-01-01T00:30:00.000Z", sessionId: "s0", window: null, resetsAt: null },
    });
    expect(mergeRecord(current, next).lastLimit?.sessionId).toBe("s1");
    const cleared = mergeRecord(current, rec({ lastLimit: null }));
    expect(cleared.lastLimit?.sessionId).toBe("s1");
  });
  test("a newer Limit replaces an older one", () => {
    const current = rec({
      lastLimit: { reportedAt: "2026-01-01T00:30:00.000Z", sessionId: "s0", window: null, resetsAt: null },
    });
    const next = rec({
      lastLimit: { reportedAt: "2026-01-01T01:00:00.000Z", sessionId: "s1", window: null, resetsAt: null },
    });
    expect(mergeRecord(current, next).lastLimit?.sessionId).toBe("s1");
  });
});

describe("parseRecord", () => {
  test("torn or unparseable counts as absent", () => {
    expect(parseRecord('{"version":1,"id":"a')).toBeNull();
    expect(parseRecord("")).toBeNull();
    expect(parseRecord('{"version":2,"id":"a"}')).toBeNull();
  });
});
