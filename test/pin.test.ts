// Pin, Override and Disabled at the process seam (ADR 0011): the four
// commands, the order of authority on every Passthrough kind, the bad-target
// exits, and a pinned session's Limit Signal, which is recorded and never
// handed off. Observed through the fake claude's call records, files under
// MCLAUDE_HOME, the usage server's request log and mclaude's own streams.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Harness, usageBody, type CallBehaviour } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

const H = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
const token = (id: string) => `sk-ant-oat01-${id}`;

function reading(o: Parameters<typeof usageBody>[0] & { age?: number } = {}) {
  const { age, ...body } = o;
  const at = ago(age ?? 10_000);
  return { lastGood: usageBody(body), fetchedAt: at, lastAttemptAt: at };
}

function launchedIn(i = 0): string | undefined {
  return h.launches()[i]?.env.CLAUDE_CONFIG_DIR;
}

function lines(s: string): string[] {
  return s.trim() === "" ? [] : s.trim().split("\n");
}

describe("account pin", () => {
  test("writes the pinned file by alias or id, one stdout line, idempotent", async () => {
    const id = h.plantAccount({ alias: "work" });
    const r = await h.run(["account", "pin", "work"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`pinned work (${id})\n`);
    expect(r.stderr).toBe("");
    expect(h.readPinned()).toBe(id);
    const again = await h.run(["account", "pin", id]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe("");
    expect(again.stderr).toBe("");
    expect(h.readPinned()).toBe(id);
  });

  test("moves the pin from one Account to another", async () => {
    const a = h.plantAccount({ alias: "a" });
    const b = h.plantAccount({ alias: "b" });
    h.setPinned(a);
    expect((await h.run(["account", "pin", "b"])).exitCode).toBe(0);
    expect(h.readPinned()).toBe(b);
  });

  test("warns on a Disabled Account and on one that Needs login, and pins anyway", async () => {
    const off = h.plantAccount({ alias: "off", disabled: true });
    const r = await h.run(["account", "pin", "off"]);
    expect(r.exitCode).toBe(0);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("Disabled");
    expect(h.readPinned()).toBe(off);

    const gone = h.plantAccount({ alias: "gone", credential: null });
    const r2 = await h.run(["account", "pin", "gone"]);
    expect(r2.exitCode).toBe(0);
    expect(lines(r2.stderr)).toHaveLength(1);
    expect(r2.stderr).toContain("account login gone");
    expect(h.readPinned()).toBe(gone);
  });

  test("an unknown name or an Orphan exits 64; a missing name exits 64", async () => {
    h.plantOrphan("orphan01");
    const orphan = await h.run(["account", "pin", "orphan01"]);
    expect(orphan.exitCode).toBe(64);
    expect(orphan.stderr).toContain("account remove orphan01");
    expect((await h.run(["account", "pin", "nope"])).exitCode).toBe(64);
    expect((await h.run(["account", "pin"])).exitCode).toBe(64);
    expect(h.readPinned()).toBeNull();
  });
});

describe("account unpin", () => {
  test("clears the file, one stdout line, idempotent", async () => {
    const id = h.plantAccount({ alias: "work" });
    h.setPinned(id);
    const r = await h.run(["account", "unpin"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`unpinned work (${id})\n`);
    expect(h.readPinned()).toBeNull();
    const again = await h.run(["account", "unpin"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe("");
    expect(again.stderr).toBe("");
  });

  test("a dangling pin is cleared too", async () => {
    h.setPinned("gonegone");
    const r = await h.run(["account", "unpin"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("unpinned gonegone\n");
    expect(h.readPinned()).toBeNull();
  });
});

describe("account disable and enable", () => {
  test("disable sets the field under the write rule, idempotent; active is untouched", async () => {
    const id = h.plantAccount({ alias: "work", active: true, usage: reading({ session: 40 }) });
    const r = await h.run(["account", "disable", "work"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`disabled work (${id})\n`);
    expect(r.stderr).toBe("");
    const rec = h.readRecord(id);
    expect(rec.disabled).toBe(true);
    expect(rec.usage.lastGood.five_hour.utilization).toBe(40);
    expect(h.readActive()).toBe(id);
    const again = await h.run(["account", "disable", id]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe("");
  });

  test("disable on the pinned Account proceeds with a warning", async () => {
    const id = h.plantAccount({ alias: "work" });
    h.setPinned(id);
    const r = await h.run(["account", "disable", "work"]);
    expect(r.exitCode).toBe(0);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("pinned");
    expect(h.readRecord(id).disabled).toBe(true);
    expect(h.readPinned()).toBe(id);
  });

  test("enable clears the field, idempotent", async () => {
    const id = h.plantAccount({ alias: "work", disabled: true });
    const r = await h.run(["account", "enable", "work"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`enabled work (${id})\n`);
    expect(h.readRecord(id).disabled).toBe(false);
    const again = await h.run(["account", "enable", "work"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe("");
  });

  test("unknown name or an Orphan exits 64", async () => {
    h.plantOrphan("orphan01");
    expect((await h.run(["account", "disable", "nope"])).exitCode).toBe(64);
    expect((await h.run(["account", "enable", "nope"])).exitCode).toBe(64);
    expect((await h.run(["account", "disable", "orphan01"])).exitCode).toBe(64);
  });

  test("a Disabled Active account makes Selection leave and stays Active until a launch lands elsewhere", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 40 }) });
    await h.startUsage({ default: { body: usageBody() } });
    expect((await h.run(["account", "disable", "a"])).exitCode).toBe(0);
    expect(h.readActive()).toBe(a);
    await h.run(["-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.readActive()).toBe(b);
  });
});

describe("Override", () => {
  test("--account <alias> forces one launch, active untouched, no usage request", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 99, age: 20 * 60_000 }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["--account", "b", "-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.launches()[0]!.env.MCLAUDE_ACCOUNT).toBe(b);
    expect(h.launches()[0]!.argv.slice(0, 2)).toEqual(["-p", "hi"]);
    expect(h.readActive()).toBe(a);
  });

  test("--account=<id> and MCLAUDE_USE_ACCOUNT; the flag wins over the variable", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    const c = h.plantAccount({ alias: "c", usage: reading({ session: 5 }) });
    await h.startUsage({ default: { body: usageBody() } });
    await h.run([`--account=${b}`, "doctor"]);
    expect(launchedIn(0)).toBe(h.accountDir(b));
    await h.run(["doctor"], { env: { MCLAUDE_USE_ACCOUNT: "c" } });
    expect(launchedIn(1)).toBe(h.accountDir(c));
    await h.run(["--account", "b", "doctor"], { env: { MCLAUDE_USE_ACCOUNT: "c" } });
    expect(launchedIn(2)).toBe(h.accountDir(b));
  });

  test("Override wins over a Pin; MCLAUDE_ACCOUNT is never read", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    const c = h.plantAccount({ alias: "c", usage: reading({ session: 5 }) });
    h.setPinned(b);
    await h.startUsage({ default: { body: usageBody() } });
    await h.run(["--account", "c", "-p", "hi"]);
    expect(launchedIn(0)).toBe(h.accountDir(c));
    expect(h.readActive()).toBe(a);
    h.setPinned("");
    await h.run(["-p", "hi"], { env: { MCLAUDE_ACCOUNT: c } });
    expect(launchedIn(1)).toBe(h.accountDir(a));
  });

  test("an unknown name exits 64 with no launch", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const r = await h.run(["--account", "nope", "-p", "hi"]);
    expect(r.exitCode).toBe(64);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("nope");
    expect(h.launches()).toHaveLength(0);
  });

  test("a Needs login target exits 1 pointing at account login, never Selection", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    h.plantAccount({ alias: "gone", credential: null });
    const r = await h.run(["--account", "gone", "-p", "hi"]);
    expect(r.exitCode).toBe(1);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("mclaude account login gone");
    expect(h.launches()).toHaveLength(0);
  });

  test("an Orphan id exits 1 pointing at account remove", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    h.plantOrphan("orphan01");
    const r = await h.run(["--account", "orphan01", "doctor"]);
    expect(r.exitCode).toBe(1);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("mclaude account remove orphan01");
    expect(h.launches()).toHaveLength(0);
  });

  test("a Disabled target launches with one stderr line", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const off = h.plantAccount({ alias: "off", disabled: true, usage: reading({ session: 5 }) });
    const r = await h.run(["--account", "off", "-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(lines(r.stderr)).toEqual([`mclaude: off (${off}) is Disabled; launching on it anyway under --account`]);
    expect(launchedIn()).toBe(h.accountDir(off));
  });
});

describe("Pin", () => {
  test("a Session start lands on the pinned Account, writes active, makes no usage request", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const work = h.plantAccount({ alias: "work", usage: reading({ session: 50, age: 20 * 60_000 }) });
    h.setPinned(work);
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(work));
    expect(h.readActive()).toBe(work);
    expect(h.readActive()).not.toBe(a);
  });

  test("a plain Passthrough lands on the pinned Account too", async () => {
    h.plantAccount({ alias: "a", active: true });
    const work = h.plantAccount({ alias: "work" });
    h.setPinned(work);
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(work));
    expect(h.readActive()).toBe(work);
  });

  test("past the threshold is silent, even with a fresher Account in the pool", async () => {
    const work = h.plantAccount({ alias: "work", active: true, usage: reading({ session: 97 }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    h.setPinned(work);
    await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(launchedIn()).toBe(h.accountDir(work));
  });

  test("holding a live Limit for the Requested model warns once and launches", async () => {
    const work = h.plantAccount({
      alias: "work",
      usage: reading({ session: 100, sessionResetsAt: ahead(H) }),
      lastLimit: { reportedAt: ago(10_000), sessionId: "s1", window: "five_hour", resetsAt: ahead(H) },
    });
    h.plantAccount({ alias: "b", active: true, usage: reading({ session: 5 }) });
    h.setPinned(work);
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toMatch(/^mclaude: work \(\w+\) is at its limit; launching on it anyway under the pin\. five_hour resets .+\.\n$/);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(work));
    expect(h.readActive()).toBe(work);
  });

  test("a scoped Limit for another model is not a wall for this launch", async () => {
    const work = h.plantAccount({
      alias: "work",
      usage: reading({ session: 5, scoped: [{ name: "Opus", percent: 100 }] }),
      lastLimit: { reportedAt: ago(10_000), sessionId: "s1", window: "Opus", resetsAt: ahead(H) },
    });
    h.setPinned(work);
    const r = await h.run(["-p", "hi", "--model", "claude-sonnet-4"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("holding a live Limit under --on-exhausted=fail exits 75 with the Exhausted line shape", async () => {
    const work = h.plantAccount({
      alias: "work",
      usage: reading({ session: 100, sessionResetsAt: ahead(H) }),
      lastLimit: { reportedAt: ago(10_000), sessionId: "s1", window: "five_hour", resetsAt: ahead(H) },
    });
    h.plantAccount({ alias: "b", active: true, usage: reading({ session: 5 }) });
    h.setPinned(work);
    const r = await h.run(["--on-exhausted=fail", "-p", "hi"]);
    expect(r.exitCode).toBe(75);
    expect(r.stdout).toBe("");
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toMatch(/^mclaude: every account is at its limit; earliest reset is work five_hour at .+\. See `mclaude account list`\n$/);
    expect(r.stderr).toContain(new Date(Date.now() + H).getFullYear().toString());
    expect(h.launches()).toHaveLength(0);
  });

  test("the Limit check is a Session start thing: a plain Passthrough on a walled pin is silent", async () => {
    const work = h.plantAccount({
      alias: "work",
      usage: reading({ session: 100, sessionResetsAt: ahead(H) }),
      lastLimit: { reportedAt: ago(10_000), sessionId: "s1", window: "five_hour", resetsAt: ahead(H) },
    });
    h.setPinned(work);
    const r = await h.run(["--on-exhausted=fail", "doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("a pinned Account that Needs login exits 1 pointing at account login; Selection does not run", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    const gone = h.plantAccount({ alias: "gone", credential: null });
    h.setPinned(gone);
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(1);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("mclaude account login gone");
    expect(usage.requests).toHaveLength(0);
    expect(h.launches()).toHaveLength(0);
  });

  test("a pin on an Orphan id exits 1 pointing at account remove", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    h.plantOrphan("orphan01");
    h.setPinned("orphan01");
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("mclaude account remove orphan01");
    expect(h.launches()).toHaveLength(0);
  });

  test("a dangling pin is ignored with one line and Selection runs", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 5 }) });
    h.setPinned("gonegone");
    await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(lines(r.stderr)).toHaveLength(1);
    expect(r.stderr).toContain("gonegone");
    expect(r.stderr).toContain("account unpin");
    expect(launchedIn()).toBe(h.accountDir(a));
  });

  test("a Disabled pinned Account launches with one stderr line", async () => {
    const off = h.plantAccount({ alias: "off", disabled: true, usage: reading({ session: 5 }) });
    h.plantAccount({ alias: "b", active: true, usage: reading({ session: 5 }) });
    h.setPinned(off);
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(lines(r.stderr)).toEqual([`mclaude: off (${off}) is Disabled; launching on it anyway under the pin`]);
    expect(launchedIn()).toBe(h.accountDir(off));
    expect(h.readActive()).toBe(off);
  });

  test("remove clears a matching pin", async () => {
    const id = h.plantAccount({ alias: "work" });
    h.setPinned(id);
    expect((await h.run(["account", "remove", "work", "--yes"])).exitCode).toBe(0);
    expect(h.readPinned()).toBeNull();
  });
});

describe("a Limit Signal under a Pin", () => {
  const WALL = "You've hit your session limit · resets 3:45pm";
  const PROMPT = "please refactor the parser";
  const user = (content: unknown) => ({ type: "user", message: { role: "user", content } });
  const errorEntry = () => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: WALL }] }, isApiErrorMessage: true, error: "rate_limit" });

  /** The child writes a transcript, fires the Limit hook, lingers a second and exits clean. */
  function walled(): CallBehaviour {
    return {
      transcript: { path: join(h.root, "transcript.jsonl"), lines: [user(PROMPT), errorEntry()] },
      hooks: [{ event: "SessionStart", payload: { source: "startup" } }, { event: "StopFailure", afterMs: 100, payload: { error: "rate_limit", last_assistant_message: WALL } }],
      sleepMs: 1500,
      exit: 0,
    };
  }

  test("the Limit is recorded with its one usage request and the child is left alone", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 10 }) });
    h.setPinned(a);
    const usage = await h.startUsage({ byToken: { [token(a)]: { body: usageBody({ session: 100 }) }, [token(b)]: { body: usageBody({ session: 10 }) } } });
    h.scenario({ calls: [walled(), { exit: 0 }] });
    const r = await h.run([]);
    expect(r.exitCode).toBe(0);
    expect(h.launches()).toHaveLength(1);
    expect(h.launches()[0]!.exitedAt).toBeDefined();
    expect(usage.requests.map((q) => q.token)).toEqual([token(a)]);
    const rec = h.readRecord(a);
    expect(rec.lastLimit.window).toBe("five_hour");
    expect(rec.lastLimit.resetsAt).not.toBeNull();
    expect(h.readActive()).toBe(a);
    expect(h.readPinned()).toBe(a);
    expect(lines(r.stderr)).toEqual(["mclaude: usage limit on a; pinned holds, staying"]);
  }, 15_000);

  test("the same under --account", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 10 }) });
    await h.startUsage({ byToken: { [token(b)]: { body: usageBody({ session: 100 }) } } });
    h.scenario({ calls: [walled(), { exit: 0 }] });
    const r = await h.run(["--account", "b"]);
    expect(r.exitCode).toBe(0);
    expect(h.launches()).toHaveLength(1);
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.readRecord(b).lastLimit.window).toBe("five_hour");
    expect(h.readActive()).toBe(a);
    expect(lines(r.stderr)).toEqual(["mclaude: usage limit on b; --account holds, staying"]);
  }, 15_000);
});

describe("account list under a Pin", () => {
  test("markers, the disabled state and --json pinned", async () => {
    const both = h.plantAccount({ alias: "both", active: true, addedAt: "2026-01-01T00:00:00.000Z" });
    const off = h.plantAccount({ alias: "off", disabled: true, addedAt: "2026-02-01T00:00:00.000Z", usage: reading({ session: 50 }) });
    const offGone = h.plantAccount({ alias: "offgone", disabled: true, credential: null, addedAt: "2026-03-01T00:00:00.000Z" });
    h.setPinned(both);
    const r = await h.run(["account", "list"]);
    const rows = r.stdout.trimEnd().split("\n").slice(1);
    expect(rows[0]!.startsWith("*!")).toBe(true);
    expect(rows[1]!.startsWith(" ")).toBe(true);
    expect(rows.map((l) => l.trim().split(/\s{2,}/).at(-1))).toEqual(["unknown", "disabled", "needs login"]);

    h.setPinned(off);
    const r2 = await h.run(["account", "list"]);
    const rows2 = r2.stdout.trimEnd().split("\n").slice(1);
    expect(rows2[0]!.startsWith("*")).toBe(true);
    expect(rows2[0]!.startsWith("*!")).toBe(false);
    expect(rows2[1]!.startsWith("!")).toBe(true);

    const json = JSON.parse((await h.run(["account", "list", "--json"])).stdout);
    expect(json.active).toBe(both);
    expect(json.pinned).toBe(off);
    expect(json.accounts.map((x: any) => [x.id, x.state])).toEqual([[both, "unknown"], [off, "disabled"], [offGone, "needs login"]]);
  });
});
