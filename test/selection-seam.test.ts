// Selection at the process seam: which Account dir the fake claude is launched
// in, how many requests reach the usage server, what `active` says afterwards,
// and the Exhausted paths (ADR 0003). Records are planted by hand.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Harness, usageBody } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

const MIN = 60_000;
const H = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A planted Reading: the body plus when it was fetched. */
function reading(o: Parameters<typeof usageBody>[0] & { age?: number } = {}) {
  const { age, ...body } = o;
  const at = ago(age ?? 10_000);
  return { lastGood: usageBody(body), fetchedAt: at, lastAttemptAt: at };
}

const token = (id: string) => `sk-ant-oat01-${id}`;

function launchedIn(): string | undefined {
  return h.launches()[0]?.env.CLAUDE_CONFIG_DIR;
}

describe("the polling schedule at a Session start", () => {
  test("a fresh Reading under the threshold launches unpolled", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(a));
    expect(r.stderr).toBe("");
  });

  test("a stale Reading under the threshold with every Reset ahead launches unpolled", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50, age: 5 * MIN }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["-p", "hi"]);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(a));
  });

  test("a stale Reading with a passed Reset gets one request", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50, age: 5 * MIN, sessionResetsAt: ago(MIN) }) });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 3 }) } });
    await h.run(["-p", "hi"]);
    expect(usage.requests.map((q) => q.token)).toEqual([token(a)]);
    expect(launchedIn()).toBe(h.accountDir(a));
    expect(h.readRecord(a).usage.lastGood.five_hour.utilization).toBe(3);
  });

  test("a Reading older than ten minutes gets one request, then stays", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50, age: 11 * MIN }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 55 }) } });
    await h.run(["-p", "hi"]);
    expect(usage.requests.map((q) => q.token)).toEqual([token(a)]);
    expect(launchedIn()).toBe(h.accountDir(a));
  });

  test("no Reading at all gets one request", async () => {
    const a = h.plantAccount({ alias: "a", active: true });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 20 }) } });
    await h.run(["-p", "hi"]);
    expect(usage.requests.map((q) => q.token)).toEqual([token(a)]);
    expect(launchedIn()).toBe(h.accountDir(a));
  });

  test("a failed refresh leaves the last Reading in force", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50, age: 11 * MIN }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    const usage = await h.startUsage({ default: { status: 500, body: {} } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(1);
    expect(launchedIn()).toBe(h.accountDir(a));
    expect(h.readRecord(a).usage.lastGood.five_hour.utilization).toBe(50);
  });

  test("a plain Passthrough makes zero requests whatever the Reading says", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 99, age: 20 * MIN }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["doctor"]);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(a));
  });

  test("an Account in backoff is not asked, and its Reading stands", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: { ...reading({ session: 50, age: 11 * MIN }), backoffUntil: ahead(MIN) } });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["-p", "hi"]);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(a));
  });
});

describe("leaving the Active account", () => {
  test("past the threshold moves to the best candidate and writes active", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 95 }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 40 }) });
    const c = h.plantAccount({ alias: "c", usage: reading({ session: 20 }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(c));
    expect(h.readActive()).toBe(c);
    expect(h.readActive()).not.toBe(a);
  });

  test("nobody qualifies: stays put, 92 is not traded for 95", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 92 }) });
    h.plantAccount({ alias: "b", usage: reading({ session: 95 }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["-p", "hi"]);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(a));
    expect(h.readActive()).toBe(a);
  });

  test("refreshes at most 8 candidates at concurrency 4, never Disabled or backoff ones", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 95, age: 11 * MIN }) });
    const candidates: string[] = [];
    for (let i = 0; i < 9; i++) candidates.push(h.plantAccount({ alias: `c${i}` }));
    const off = h.plantAccount({ alias: "off", disabled: true });
    const held = h.plantAccount({ alias: "held", usage: { ...reading({ session: 97, age: 5 * MIN }), backoffUntil: ahead(MIN) } });
    const usage = await h.startUsage({
      byToken: { [token(a)]: { body: usageBody({ session: 96 }) } },
      default: { body: usageBody({ session: 10 }), delayMs: 300 },
    });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(1 + 8);
    expect(usage.requests[0]!.token).toBe(token(a));
    const polled = usage.requests.slice(1).map((q) => q.token);
    expect(polled).not.toContain(token(off));
    expect(polled).not.toContain(token(held));
    expect(new Set(polled).size).toBe(8);
    // Four in flight at once: the fifth candidate request waits for the first batch.
    const t = usage.requests.slice(1).map((q) => q.at);
    expect(t[3]! - t[0]!).toBeLessThan(250);
    expect(t[4]! - t[0]!).toBeGreaterThanOrEqual(250);
    const launched = launchedIn();
    expect(candidates.map((id) => h.accountDir(id))).toContain(launched!);
    expect(launched).not.toBe(h.accountDir(a));
  }, 30_000);

  test("a live Limit on the Active account for the Requested model moves; one for another model does not", async () => {
    const a = h.plantAccount({
      alias: "a",
      active: true,
      usage: reading({ session: 10, scoped: [{ name: "Opus", percent: 100 }], age: 20_000 }),
      lastLimit: { reportedAt: ago(10_000), sessionId: "s1", window: "Opus", resetsAt: ahead(H) },
    });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 40 }) });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 10, scoped: [{ name: "Opus", percent: 100 }] }) } });
    await h.run(["-p", "hi", "--model", "claude-opus-4-1"]);
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(usage.requests.map((q) => q.token)).toEqual([token(a)]);
    await h.run(["-p", "hi", "--model", "claude-sonnet-4"], { env: {} });
    expect(h.launches()[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(b));
    h.setActive(a);
    await h.run(["-p", "hi", "--model", "claude-sonnet-4"]);
    expect(h.launches()[2]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(a));
  });

  test("an Active account that Needs login yields to a known Account with room", async () => {
    h.plantAccount({ alias: "gone", active: true, credential: null });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 40 }) });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["-p", "hi"]);
    expect(usage.requests).toHaveLength(0);
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.readActive()).toBe(b);
  });

  test("no Active account picks the best candidate", async () => {
    h.plantAccount({ alias: "a", usage: reading({ session: 40 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 20 }) });
    await h.startUsage({ default: { body: usageBody() } });
    await h.run(["-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.readActive()).toBe(b);
  });

  test("an Unknown Account is the probe when nothing known qualifies", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 95 }) });
    const u = h.plantAccount({ alias: "u" });
    const usage = await h.startUsage({ default: { status: 500, body: {} } });
    await h.run(["-p", "hi"]);
    expect(usage.requests.map((q) => q.token)).toEqual([token(u)]);
    expect(launchedIn()).toBe(h.accountDir(u));
    expect(h.readActive()).not.toBe(a);
  });
});

describe("the Switch threshold", () => {
  let a: string;
  let b: string;
  beforeEach(async () => {
    a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    b = h.plantAccount({ alias: "b", usage: reading({ session: 10 }) });
    await h.startUsage({ default: { body: usageBody() } });
  });

  test("defaults to 90", async () => {
    await h.run(["-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(a));
  });
  test("--switch-threshold", async () => {
    await h.run(["--switch-threshold", "40", "-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("MCLAUDE_SWITCH_THRESHOLD", async () => {
    await h.run(["-p", "hi"], { env: { MCLAUDE_SWITCH_THRESHOLD: "40" } });
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("config switchThreshold", async () => {
    h.writeConfig(`{ "switchThreshold": 40 }`);
    await h.run(["-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("flag over env over config", async () => {
    h.writeConfig(`{ "switchThreshold": 40 }`);
    await h.run(["-p", "hi"], { env: { MCLAUDE_SWITCH_THRESHOLD: "60" } });
    expect(launchedIn()).toBe(h.accountDir(a));
    await h.run(["--switch-threshold=40", "-p", "hi"], { env: { MCLAUDE_SWITCH_THRESHOLD: "60" } });
    expect(h.launches()[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(b));
  });
});

describe("the Requested model steers the applicable Windows", () => {
  let a: string;
  let b: string;
  beforeEach(async () => {
    a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 10, scoped: [{ name: "Opus", percent: 99 }, { name: "Sonnet", percent: 10 }] }) });
    b = h.plantAccount({ alias: "b", usage: reading({ session: 5 }) });
    await h.startUsage({ default: { body: usageBody() } });
  });

  test("--model names a model outside the full Window: stays", async () => {
    await h.run(["-p", "hi", "--model", "claude-sonnet-4"]);
    expect(launchedIn()).toBe(h.accountDir(a));
  });
  test("--model names the full Window: leaves", async () => {
    await h.run(["-p", "hi", "--model=opus"]);
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("opusplan means opus", async () => {
    await h.run(["-p", "hi", "--model", "opusplan"]);
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("--fallback-model is ignored", async () => {
    await h.run(["-p", "hi", "--model", "sonnet", "--fallback-model", "opus"]);
    expect(launchedIn()).toBe(h.accountDir(a));
  });
  test("ANTHROPIC_MODEL", async () => {
    await h.run(["-p", "hi"], { env: { ANTHROPIC_MODEL: "claude-opus-4-1" } });
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("the cwd's .claude/settings.json, overridden by settings.local.json", async () => {
    const cwd = join(h.root, "project");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    await h.run(["-p", "hi"], { cwd });
    expect(launchedIn()).toBe(h.accountDir(b));
    writeFileSync(join(cwd, ".claude", "settings.local.json"), JSON.stringify({ model: "sonnet" }));
    h.setActive(a);
    await h.run(["-p", "hi"], { cwd });
    expect(h.launches()[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(a));
  });
  test("the Shared home settings.json", async () => {
    writeFileSync(join(h.sharedHome, "settings.json"), JSON.stringify({ model: "sonnet" }));
    await h.run(["-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(a));
  });
  test("no model anywhere counts every scoped Window", async () => {
    await h.run(["-p", "hi"]);
    expect(launchedIn()).toBe(h.accountDir(b));
  });
  test("the child's argv is never rewritten to find Headroom", async () => {
    await h.run(["-p", "hi", "--model", "opus"]);
    expect(h.launches()[0]!.argv).toEqual(["-p", "hi", "--model", "opus"]);
  });
});

describe("Exhausted (ADR 0003)", () => {
  const line = /^mclaude: every account is at its limit\. Launching on (\S+); (.+)\n$/;

  test("launches on the Account whose wall lifts soonest, active untouched, one stderr line", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 100, sessionResetsAt: ahead(3 * H) }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 100, sessionResetsAt: ahead(H) }) });
    await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    const m = r.stderr.match(line);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("b");
    expect(m![2]).toMatch(/^five_hour resets .+\.$/);
    expect(m![2]).toContain(new Date(Date.now() + H).getFullYear().toString());
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.readActive()).toBe(a);
  });

  test("Credits come before waiting on a Reset; a reached spend limit does not count", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 100, sessionResetsAt: ahead(MIN) }) });
    const c = h.plantAccount({ alias: "c", usage: reading({ session: 100, credits: true }) });
    h.plantAccount({ alias: "spent", usage: reading({ session: 100, credits: true, spendLimitReached: true }) });
    await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    const r = await h.run(["-p", "hi"]);
    expect(r.stderr).toBe("mclaude: every account is at its limit. Launching on c; using extra usage credits.\n");
    expect(launchedIn()).toBe(h.accountDir(c));
    expect(h.readActive()).toBe(a);
  });

  test("every Account full but one Unknown: the Unknown is launched as the probe, no Exhausted line", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 100 }) });
    const u = h.plantAccount({ alias: "u" });
    await h.startUsage({ default: { status: 500, body: {} } });
    const r = await h.run(["-p", "hi"]);
    expect(r.stderr).toBe("");
    expect(launchedIn()).toBe(h.accountDir(u));
  });

  test("the candidates are refreshed before Exhausted is declared", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 100 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 100, age: 5 * MIN }) });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 30 }) } });
    const r = await h.run(["-p", "hi"]);
    expect(usage.requests.map((q) => q.token)).toEqual([token(b)]);
    expect(r.stderr).toBe("");
    expect(launchedIn()).toBe(h.accountDir(b));
    expect(h.readActive()).toBe(b);
    expect(h.readActive()).not.toBe(a);
  });

  test("a Disabled Account with room does not rescue an Exhausted pool", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 100 }) });
    h.plantAccount({ alias: "off", disabled: true, usage: reading({ session: 1 }) });
    await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    const r = await h.run(["-p", "hi"]);
    expect(r.stderr).toMatch(line);
    expect(launchedIn()).toBe(h.accountDir(a));
  });

  describe("onExhausted=fail", () => {
    beforeEach(async () => {
      h.plantAccount({ alias: "a", active: true, usage: reading({ session: 100, sessionResetsAt: ahead(3 * H) }) });
      h.plantAccount({ alias: "b", usage: reading({ session: 100, sessionResetsAt: ahead(H) }) });
      await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    });

    function expectFailed(r: { exitCode: number | null; stdout: string; stderr: string }, launchesBefore = 0) {
      expect(r.exitCode).toBe(75);
      expect(r.stdout).toBe("");
      expect(r.stderr.trim().split("\n")).toHaveLength(1);
      expect(r.stderr).toMatch(/^mclaude: every account is at its limit; earliest reset is b five_hour at .+\. See `mclaude account list`\n$/);
      expect(h.launches()).toHaveLength(launchesBefore);
    }

    test("--on-exhausted=fail", async () => {
      expectFailed(await h.run(["--on-exhausted=fail", "-p", "hi"]));
    });
    test("MCLAUDE_ON_EXHAUSTED=fail", async () => {
      expectFailed(await h.run(["-p", "hi"], { env: { MCLAUDE_ON_EXHAUSTED: "fail" } }));
    });
    test("config onExhausted", async () => {
      h.writeConfig(`{ "onExhausted": "fail" }`);
      expectFailed(await h.run(["-p", "hi"]));
    });
    test("flag over env over config", async () => {
      h.writeConfig(`{ "onExhausted": "fail" }`);
      let r = await h.run(["-p", "hi"], { env: { MCLAUDE_ON_EXHAUSTED: "launch" } });
      expect(r.exitCode).toBe(0);
      expect(h.launches()).toHaveLength(1);
      expectFailed(await h.run(["--on-exhausted", "fail", "-p", "hi"], { env: { MCLAUDE_ON_EXHAUSTED: "launch" } }), 1);
      h.writeConfig(`{ "onExhausted": "launch" }`);
      r = await h.run(["--on-exhausted", "launch", "-p", "hi"], { env: { MCLAUDE_ON_EXHAUSTED: "fail" } });
      expect(r.exitCode).toBe(0);
      expect(h.launches()).toHaveLength(2);
    });
    test("the knob is read only at a Session start; a plain Passthrough launches", async () => {
      const r = await h.run(["--on-exhausted=fail", "doctor"]);
      expect(r.exitCode).toBe(0);
      expect(h.launches()).toHaveLength(1);
    });
  });
});
