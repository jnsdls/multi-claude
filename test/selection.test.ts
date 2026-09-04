import { describe, expect, test } from "bun:test";
import type { AccountRecord } from "../src/record.ts";
import { earliestWall, fallback, refreshOrder, select, type Selection } from "../src/selection.ts";
import { CANDIDATE_CAP } from "../src/windows.ts";
import { body, H, iso, limit, MIN, NOW, record } from "./harness/records.ts";

function run(records: AccountRecord[], activeId: string | null, o: { model?: string | null; threshold?: number; now?: number } = {}): Selection {
  return select({ records, activeId, model: o.model === undefined ? null : o.model, threshold: o.threshold ?? 90, now: o.now ?? NOW });
}

function picked(s: Selection): string | null {
  return s.kind === "stay" || s.kind === "move" ? s.id : null;
}

describe("select: staying", () => {
  test("the Active account under the threshold stays", () => {
    const rs = [record({ id: "a", body: body({ session: 50 }) }), record({ id: "b", body: body({ session: 5 }) })];
    expect(run(rs, "a")).toMatchObject({ kind: "stay", id: "a" });
  });
  test("89 stays, 90 leaves: at the threshold is past it", () => {
    const at = [record({ id: "a", body: body({ session: 90 }) }), record({ id: "b", body: body({ session: 5 }) })];
    expect(run(at, "a")).toMatchObject({ kind: "move", id: "b", from: "a" });
    const under = [record({ id: "a", body: body({ session: 89 }) }), record({ id: "b", body: body({ session: 5 }) })];
    expect(run(under, "a")).toMatchObject({ kind: "stay", id: "a" });
  });
  test("the threshold is a setting", () => {
    const rs = [record({ id: "a", body: body({ session: 50 }) }), record({ id: "b", body: body({ session: 5 }) })];
    expect(picked(run(rs, "a", { threshold: 50 }))).toBe("b");
    expect(picked(run(rs, "a", { threshold: 51 }))).toBe("a");
  });
  test("92 vs 95: nothing qualifies, stay put", () => {
    const rs = [record({ id: "a", body: body({ session: 92 }) }), record({ id: "b", body: body({ session: 95 }) })];
    expect(run(rs, "a")).toMatchObject({ kind: "stay", id: "a" });
  });
  test("a scoped Window for another model does not push you off", () => {
    const rs = [record({ id: "a", body: body({ session: 10, scoped: [["Opus", 99], ["Sonnet", 20]] }) }), record({ id: "b", body: body({ session: 5 }) })];
    expect(picked(run(rs, "a", { model: "claude-sonnet-4" }))).toBe("a");
    expect(picked(run(rs, "a", { model: "claude-opus-4-1" }))).toBe("b");
  });
  test("an unknown model counts every scoped Window", () => {
    const rs = [record({ id: "a", body: body({ session: 10, scoped: [["Opus", 99]] }) }), record({ id: "b", body: body({ session: 5 }) })];
    expect(picked(run(rs, "a", { model: null }))).toBe("b");
  });
  test("Active Unknown and nothing known stays", () => {
    const rs = [record({ id: "a", body: null }), record({ id: "b", body: null })];
    expect(run(rs, "a")).toMatchObject({ kind: "stay", id: "a" });
  });
  test("Active Unknown while a known Account is under threshold leaves", () => {
    const rs = [record({ id: "a", body: null }), record({ id: "b", body: body({ session: 30 }) })];
    expect(run(rs, "a")).toMatchObject({ kind: "move", id: "b" });
  });
  test("Active Unknown while the only known Account is past threshold stays", () => {
    const rs = [record({ id: "a", body: null }), record({ id: "b", body: body({ session: 95 }) })];
    expect(run(rs, "a")).toMatchObject({ kind: "stay", id: "a" });
  });
});

describe("select: leaving", () => {
  test("a Disabled Active account is left even when it has room", () => {
    const rs = [record({ id: "a", disabled: true, body: body({ session: 5 }) }), record({ id: "b", body: body({ session: 40 }) })];
    expect(run(rs, "a")).toMatchObject({ kind: "move", id: "b" });
  });
  test("a live Limit for the Requested model bars the Active account", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100 }), fetchedAt: -15 * MIN, lastLimit: limit({ reportedAt: -5 * MIN, resetsAt: H }) }),
      record({ id: "b", body: body({ session: 40 }) }),
    ];
    expect(run(rs, "a")).toMatchObject({ kind: "move", id: "b" });
  });
  test("a live scoped Limit for another model does not", () => {
    const rs = [
      record({ id: "a", body: body({ session: 10, scoped: [["Opus", 100]] }), fetchedAt: -15 * MIN, lastLimit: limit({ reportedAt: -5 * MIN, window: "Opus", resetsAt: H }) }),
      record({ id: "b", body: body({ session: 40 }) }),
    ];
    expect(picked(run(rs, "a", { model: "claude-sonnet-4" }))).toBe("a");
    expect(picked(run(rs, "a", { model: "claude-opus-4-1" }))).toBe("b");
  });
  test("candidates rank by lowest max Utilization across applicable Windows", () => {
    const rs = [
      record({ id: "a", body: body({ session: 95 }) }),
      record({ id: "b", body: body({ session: 10, week: 60 }) }),
      record({ id: "c", body: body({ session: 30, week: 30 }) }),
    ];
    expect(picked(run(rs, "a"))).toBe("c");
  });
  test("ties go to the earliest Reset of the tightest Window", () => {
    const rs = [
      record({ id: "a", body: body({ session: 95 }) }),
      record({ id: "b", body: body({ session: 30, sessionReset: iso(3 * H) }) }),
      record({ id: "c", body: body({ session: 30, sessionReset: iso(H) }) }),
    ];
    expect(picked(run(rs, "a"))).toBe("c");
  });
  test("Unknown Accounts rank after every qualifying known one", () => {
    const rs = [record({ id: "a", body: body({ session: 95 }) }), record({ id: "u", body: null }), record({ id: "b", body: body({ session: 80 }) })];
    expect(picked(run(rs, "a"))).toBe("b");
  });
  test("Unknown Accounts are tried when nothing known qualifies", () => {
    const rs = [record({ id: "a", body: body({ session: 95 }) }), record({ id: "u2", body: null, addedAt: -H }), record({ id: "u1", body: null, addedAt: -2 * H })];
    expect(picked(run(rs, "a"))).toBe("u1");
  });
  test("Disabled Accounts are never candidates", () => {
    const rs = [record({ id: "a", body: body({ session: 95 }) }), record({ id: "d", disabled: true, body: body({ session: 1 }) }), record({ id: "b", body: body({ session: 50 }) })];
    expect(picked(run(rs, "a"))).toBe("b");
  });
  test("a full Active account moves to an Account with Headroom even past the threshold", () => {
    const rs = [record({ id: "a", body: body({ session: 100 }) }), record({ id: "b", body: body({ session: 95 }) })];
    expect(run(rs, "a")).toMatchObject({ kind: "move", id: "b" });
  });
  test("a Limit whose trust ended leaves the Account Unknown: after qualifying known ones, before a wall", () => {
    const expired = record({ id: "a", body: body({ session: 100 }), fetchedAt: -3 * H, lastLimit: limit({ reportedAt: -2 * H, resetsAt: -MIN }) });
    expect(picked(run([expired, record({ id: "b", body: body({ session: 50 }) })], "b"))).toBe("b");
    expect(picked(run([expired, record({ id: "b", body: body({ session: 95 }) })], "b"))).toBe("a");
    expect(picked(run([expired, record({ id: "b", body: body({ session: 95 }) })], "a"))).toBe("a");
  });
});

describe("select: no Active account", () => {
  test("picks the best candidate as if moving", () => {
    const rs = [record({ id: "a", body: body({ session: 40 }) }), record({ id: "b", body: body({ session: 20 }) })];
    expect(run(rs, null)).toMatchObject({ kind: "move", id: "b", from: null });
  });
  test("a dangling active id is no Active account", () => {
    const rs = [record({ id: "a", body: body({ session: 40 }) })];
    expect(run(rs, "gone")).toMatchObject({ kind: "move", id: "a" });
  });
  test("nothing qualifies and Unknown Accounts exist: the first Unknown in addedAt order", () => {
    const rs = [record({ id: "a", body: body({ session: 95 }) }), record({ id: "u2", body: null, addedAt: -H }), record({ id: "u1", body: null, addedAt: -2 * H })];
    expect(picked(run(rs, null))).toBe("u1");
  });
  test("every Account Disabled is none", () => {
    expect(run([record({ id: "a", disabled: true, body: body() })], null)).toEqual({ kind: "none" });
  });
});

describe("select: ADR 0007 convergence", () => {
  test("two Accounts full, three sessions each on one of them all pick the same third", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100 }), fetchedAt: -2 * MIN, lastLimit: limit({ reportedAt: -MIN, resetsAt: 2 * H }) }),
      record({ id: "b", body: body({ session: 100 }), fetchedAt: -2 * MIN, lastLimit: limit({ reportedAt: -MIN, resetsAt: H }) }),
      record({ id: "c", body: body({ session: 20 }) }),
    ];
    for (const active of ["a", "b", "c"]) expect(picked(run(rs, active))).toBe("c");
  });
  test("the Account a session is leaving stays a candidate once its Limit clears", () => {
    const rs = [
      record({ id: "a", body: body({ session: 10 }), fetchedAt: -30_000, lastLimit: limit({ reportedAt: -MIN, resetsAt: 2 * H }) }),
      record({ id: "b", body: body({ session: 60 }) }),
    ];
    expect(picked(run(rs, "b", { threshold: 50 }))).toBe("a");
  });
});

describe("select: Exhausted", () => {
  test("every eligible Account full is Exhausted", () => {
    const rs = [record({ id: "a", body: body({ session: 100 }) }), record({ id: "b", body: body({ week: 100 }) })];
    expect(run(rs, "a")).toEqual({ kind: "exhausted" });
  });
  test("a live Limit counts as no Headroom", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100 }) }),
      record({ id: "b", body: body({ session: 40 }), fetchedAt: -15 * MIN, lastLimit: limit({ reportedAt: -5 * MIN, resetsAt: H }) }),
    ];
    expect(run(rs, "a")).toEqual({ kind: "exhausted" });
  });
  test("the threshold never makes an Account Exhausted", () => {
    const rs = [record({ id: "a", body: body({ session: 99 }) }), record({ id: "b", body: body({ session: 99 }) })];
    expect(run(rs, "a", { threshold: 50 })).toMatchObject({ kind: "stay", id: "a" });
  });
  test("an Unknown Account is never Exhausted", () => {
    const rs = [record({ id: "a", body: body({ session: 100 }) }), record({ id: "u", body: null })];
    expect(run(rs, "a")).toMatchObject({ kind: "move", id: "u" });
  });
  test("a Disabled Account with room does not save an Exhausted pool", () => {
    const rs = [record({ id: "a", body: body({ session: 100 }) }), record({ id: "d", disabled: true, body: body({ session: 1 }) })];
    expect(run(rs, "a")).toEqual({ kind: "exhausted" });
  });
  test("a full scoped Window for another model is not Exhausted for this one", () => {
    const rs = [record({ id: "a", body: body({ session: 10, scoped: [["Opus", 100]] }) })];
    expect(run(rs, "a", { model: "claude-sonnet-4" })).toMatchObject({ kind: "stay", id: "a" });
    expect(run(rs, "a", { model: "claude-opus-4-1" })).toEqual({ kind: "exhausted" });
  });
});

describe("fallback", () => {
  test("Unknown first, in addedAt order", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100, credits: true }) }),
      record({ id: "u2", body: null, addedAt: -H }),
      record({ id: "u1", body: null, addedAt: -2 * H }),
    ];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "u1" }, tier: "unknown", window: null, resetsAt: null });
  });
  test("then Credits enabled with the spend limit not reached, earliest Reset breaking ties", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100, sessionReset: iso(H) }) }),
      record({ id: "b", body: body({ session: 100, sessionReset: iso(3 * H), credits: true }) }),
      record({ id: "c", body: body({ session: 100, sessionReset: iso(2 * H), credits: true }) }),
    ];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "c" }, tier: "credits", window: "five_hour", resetsAt: iso(2 * H) });
  });
  test("spend limit reached takes Credits out of the tier", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100, sessionReset: iso(H) }) }),
      record({ id: "b", body: body({ session: 100, sessionReset: iso(3 * H), credits: true, spendLimitReached: true }) }),
    ];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "a" }, tier: "reset", window: "five_hour", resetsAt: iso(H) });
  });
  test("a null spend_limit_reached still counts as Credits", () => {
    const rs = [record({ id: "a", body: body({ session: 100, sessionReset: iso(H) }) }), record({ id: "b", body: body({ session: 100, credits: true, spendLimitReached: null }) })];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "b" }, tier: "credits" });
  });
  test("then the earliest Reset of the tightest Window", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100, sessionReset: iso(3 * H) }) }),
      record({ id: "b", body: body({ week: 100, weekReset: iso(H) }) }),
    ];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "b" }, tier: "reset", window: "seven_day", resetsAt: iso(H) });
  });
  test("a live Limit's Reset is the wall it waits on", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100, sessionReset: iso(3 * H) }) }),
      record({ id: "b", body: body({ session: 40 }), fetchedAt: -15 * MIN, lastLimit: limit({ reportedAt: -5 * MIN, window: "five_hour", resetsAt: H }) }),
    ];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "b" }, tier: "reset", window: "five_hour", resetsAt: iso(H) });
  });
  test("Disabled skipped; every Account Disabled is null", () => {
    const rs = [record({ id: "d", disabled: true, body: null }), record({ id: "a", body: body({ session: 100 }) })];
    expect(fallback(rs, null, NOW)).toMatchObject({ record: { id: "a" }, tier: "reset" });
    expect(fallback([rs[0]!], null, NOW)).toBeNull();
  });
  test("earliestWall names the soonest Reset among eligible Accounts", () => {
    const rs = [
      record({ id: "a", body: body({ session: 100, sessionReset: iso(3 * H) }) }),
      record({ id: "b", body: body({ session: 100, sessionReset: iso(H) }) }),
      record({ id: "d", disabled: true, body: body({ session: 100, sessionReset: iso(MIN) }) }),
    ];
    expect(earliestWall(rs, null, NOW)).toMatchObject({ record: { id: "b" }, window: "five_hour", resetsAt: iso(H) });
    expect(earliestWall([record({ id: "u", body: null })], null, NOW)).toBeNull();
  });
});

describe("refreshOrder", () => {
  test("three tiers: by cached Headroom, never polled by addedAt, errored by addedAt", () => {
    const rs = [
      record({ id: "active", body: body({ session: 95 }), fetchedAt: -5 * MIN }),
      record({ id: "err2", body: null, lastAttemptAt: -MIN, addedAt: -H }),
      record({ id: "new2", body: null, addedAt: -H }),
      record({ id: "r60", body: body({ session: 60 }), fetchedAt: -5 * MIN }),
      record({ id: "err1", body: null, lastAttemptAt: -MIN, addedAt: -2 * H }),
      record({ id: "r20", body: body({ session: 20 }), fetchedAt: -5 * MIN }),
      record({ id: "new1", body: null, addedAt: -2 * H }),
    ];
    expect(refreshOrder(rs, "active", null, NOW).map((r) => r.id)).toEqual(["r20", "r60", "new1", "new2", "err1", "err2"]);
  });
  test("cached Headroom uses the applicable Windows", () => {
    const rs = [record({ id: "a", body: body({ session: 10, scoped: [["Opus", 90]] }), fetchedAt: -5 * MIN }), record({ id: "b", body: body({ session: 30 }), fetchedAt: -5 * MIN })];
    expect(refreshOrder(rs, null, "claude-sonnet-4", NOW).map((r) => r.id)).toEqual(["a", "b"]);
    expect(refreshOrder(rs, null, "claude-opus-4-1", NOW).map((r) => r.id)).toEqual(["b", "a"]);
  });
  test("Disabled and backoff Accounts are never probed", () => {
    const rs = [
      record({ id: "d", disabled: true, body: null }),
      record({ id: "held", body: body({ session: 1 }), fetchedAt: -5 * MIN, backoffUntil: MIN }),
      record({ id: "freed", body: body({ session: 2 }), fetchedAt: -5 * MIN, backoffUntil: -MIN }),
    ];
    expect(refreshOrder(rs, null, null, NOW).map((r) => r.id)).toEqual(["freed"]);
  });
  test("a fresh Reading is not asked for again", () => {
    const rs = [record({ id: "fresh", body: body({ session: 1 }), fetchedAt: -10_000 }), record({ id: "stale", body: body({ session: 2 }), fetchedAt: -5 * MIN })];
    expect(refreshOrder(rs, null, null, NOW).map((r) => r.id)).toEqual(["stale"]);
  });
  test("at most CANDIDATE_CAP", () => {
    const rs = Array.from({ length: 12 }, (_, i) => record({ id: `n${i}`, body: null, addedAt: -12 * H + i * H }));
    const order = refreshOrder(rs, null, null, NOW);
    expect(order).toHaveLength(CANDIDATE_CAP);
    expect(order.map((r) => r.id)).toEqual(rs.slice(0, CANDIDATE_CAP).map((r) => r.id));
  });
});
