// The Limit hook at the process seam (ADR 0008, ADR 0007): the argv and
// settings file a Session start hands the fake claude, the Signal dir, the
// Record after a rate_limit Signal, the single post-Limit request, the sweep,
// and what `list` says about a live Limit.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Harness, usageBody } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

const MIN = 60_000;
const H = 3600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WALL = "You've hit your session limit · resets 3:45pm";
const token = (id: string) => `sk-ant-oat01-${id}`;

function reading(o: Parameters<typeof usageBody>[0] & { age?: number } = {}) {
  const { age, ...body } = o;
  const at = ago(age ?? 10_000);
  return { lastGood: usageBody(body), fetchedAt: at, lastAttemptAt: at };
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.lastIndexOf(name);
  return i < 0 ? undefined : argv[i + 1];
}

function limitsDir(): string {
  return join(h.mclaudeHome, "limits");
}

/** Spawns a Session start whose fake claude lingers, and returns its call record once it is up. */
async function spawnLingering(args: string[], behaviour: Record<string, unknown> = {}) {
  h.scenario({ default: { sleepMs: 4000, ...behaviour } });
  const p = h.spawn(args);
  await h.waitFor(() => h.launches().length === 1);
  return { p, call: h.launches()[0]! };
}

describe("a Session start carries the Limit hook", () => {
  test("appends --session-id <uuid> and --settings <limits/<uuid>/settings.json> last, dir 0700, file 0600", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const { p, call } = await spawnLingering(["-p", "hi", "--model", "opus"]);
    const argv = call.argv;
    expect(argv.slice(0, 4)).toEqual(["-p", "hi", "--model", "opus"]);
    expect(argv[4]).toBe("--session-id");
    const id = argv[5]!;
    expect(id).toMatch(UUID);
    expect(argv.slice(6)).toEqual(["--settings", join(limitsDir(), id, "settings.json")]);
    expect(call.env.MCLAUDE_LIMIT_DIR).toBe(join(limitsDir(), id));
    expect(statSync(join(limitsDir(), id)).mode & 0o777).toBe(0o700);
    expect(statSync(argv[7]!).mode & 0o777).toBe(0o600);
    p.kill("SIGTERM");
    await p.exited;
  });

  test("the settings file holds exactly the two entries with an absolute command that writes a Signal", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const { p, call } = await spawnLingering(["-p", "hi"]);
    const settings = JSON.parse(readFileSync(flag(call.argv, "--settings")!, "utf8"));
    expect(Object.keys(settings)).toEqual(["hooks"]);
    expect(Object.keys(settings.hooks).sort()).toEqual(["SessionStart", "StopFailure"]);
    expect(settings.hooks.StopFailure).toHaveLength(1);
    expect(settings.hooks.StopFailure[0].matcher).toBe("rate_limit");
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].matcher).toBeUndefined();
    const command: string = settings.hooks.StopFailure[0].hooks[0].command;
    expect(settings.hooks.SessionStart[0].hooks[0]).toEqual({ type: "command", command });
    expect(command).toMatch(/ hook$/);
    expect(command).toMatch(/^'\//);

    const dir = join(h.root, "hook-run");
    const payload = { hook_event_name: "StopFailure", session_id: "s-x", error: "rate_limit" };
    const run = Bun.spawn(["sh", "-c", command], {
      env: { ...h.env(), MCLAUDE_LIMIT_DIR: dir, MCLAUDE_ACCOUNT: "acct" },
      stdin: new TextEncoder().encode(JSON.stringify(payload)),
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await run.exited).toBe(0);
    expect(await new Response(run.stderr as ReadableStream).text()).toBe("");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^StopFailure-\d+\.json$/);
    const signal = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
    expect(signal.payload).toEqual(payload);
    expect(signal.accountId).toBe("acct");
    p.kill("SIGTERM");
    await p.exited;
  });

  test("--resume <id> names the dir and gets no --session-id", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const { p, call } = await spawnLingering(["--resume", "abc-123"]);
    expect(call.argv).toEqual(["--resume", "abc-123", "--settings", join(limitsDir(), "abc-123", "settings.json")]);
    expect(call.env.MCLAUDE_LIMIT_DIR).toBe(join(limitsDir(), "abc-123"));
    p.kill("SIGTERM");
    await p.exited;
  });

  test("a user --settings path is merged: user entries kept, mclaude's appended, only the merged file passed", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const mine = { type: "command", command: "echo mine" };
    const userPath = join(h.root, "user-settings.json");
    writeFileSync(userPath, JSON.stringify({ model: "opus", hooks: { StopFailure: [{ matcher: ".*", hooks: [mine] }], Stop: [{ hooks: [mine] }] } }));
    const { p, call } = await spawnLingering(["--settings", userPath, "-p", "hi"]);
    expect(call.argv.filter((a) => a === "--settings")).toHaveLength(1);
    expect(call.argv.slice(0, 2)).toEqual(["-p", "hi"]);
    const merged = JSON.parse(readFileSync(flag(call.argv, "--settings")!, "utf8"));
    expect(merged.model).toBe("opus");
    expect(merged.hooks.Stop).toEqual([{ hooks: [mine] }]);
    expect(merged.hooks.StopFailure[0]).toEqual({ matcher: ".*", hooks: [mine] });
    expect(merged.hooks.StopFailure[1].matcher).toBe("rate_limit");
    expect(merged.hooks.SessionStart).toHaveLength(1);
    p.kill("SIGTERM");
    await p.exited;
  });

  test("a user --settings with inline JSON is merged the same way", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const { p, call } = await spawnLingering(["-p", "hi", `--settings={"permissions":{"allow":["Bash"]},"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo u"}]}]}}`]);
    expect(call.argv.filter((a) => a.startsWith("--settings"))).toHaveLength(1);
    const merged = JSON.parse(readFileSync(flag(call.argv, "--settings")!, "utf8"));
    expect(merged.permissions).toEqual({ allow: ["Bash"] });
    expect(merged.hooks.SessionStart).toHaveLength(2);
    expect(merged.hooks.SessionStart[0].hooks[0].command).toBe("echo u");
    expect(merged.hooks.StopFailure).toHaveLength(1);
    p.kill("SIGTERM");
    await p.exited;
  });

  test("an unparseable user --settings is forwarded untouched with one warning", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const r = await h.run(["--settings", "/nonexistent/settings.json", "-p", "hi"]);
    expect(r.exitCode).toBe(0);
    const argv = h.launches()[0]!.argv;
    expect(argv.slice(0, 4)).toEqual(["--settings", "/nonexistent/settings.json", "-p", "hi"]);
    expect(argv[4]).toBe("--session-id");
    expect(argv).toHaveLength(6);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("Limit detection is off");
  });

  test("--safe-mode warns that Handoff is off", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const r = await h.run(["--safe-mode", "-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("Handoff is off");
  });

  test("a plain Passthrough gets no --settings, no Signal dir and no MCLAUDE_LIMIT_DIR", async () => {
    h.plantAccount({ active: true });
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    const call = h.launches()[0]!;
    expect(call.argv).toEqual(["doctor"]);
    expect(call.env.MCLAUDE_LIMIT_DIR).toBeUndefined();
    expect(existsSync(limitsDir())).toBe(false);
  });
});

describe("a rate_limit Signal records the Limit", () => {
  test("Signal files land, the Record gets lastLimit, one request names the Window, the dir is gone after exit", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const body = usageBody({ session: 100 });
    const usage = await h.startUsage({ default: { body } });
    h.scenario({
      default: {
        hooks: [
          { event: "SessionStart", payload: { source: "startup" } },
          { event: "StopFailure", afterMs: 50, payload: { error: "rate_limit", last_assistant_message: WALL } },
        ],
        sleepMs: 1500,
      },
    });
    const before = Date.now();
    const p = h.spawn(["-p", "hi"]);
    await h.waitFor(() => h.launches()[0]?.hooksRan_StopFailure !== undefined);
    const call = h.launches()[0]!;
    expect(call.hooksRan_SessionStart).toBe(1);
    expect(call.hooksRan_StopFailure).toBe(1);
    const dir = call.env.MCLAUDE_LIMIT_DIR!;
    const files = readdirSync(dir).sort();
    expect(files.filter((f) => f.startsWith("SessionStart-"))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith("StopFailure-"))).toHaveLength(1);
    expect(files).toContain("settings.json");
    await p.exited;
    expect(p.exitCode).toBe(0);

    const sessionId = flag(call.argv, "--session-id")!;
    const record = h.readRecord(a);
    expect(record.lastLimit.sessionId).toBe(sessionId);
    expect(Date.parse(record.lastLimit.reportedAt)).toBeGreaterThanOrEqual(before);
    expect(record.lastLimit.window).toBe("five_hour");
    expect(record.lastLimit.resetsAt).toBe((body.five_hour as { resets_at: string }).resets_at);
    expect(usage.requests.map((q) => q.token)).toEqual([token(a)]);
    expect(Date.parse(record.usage.fetchedAt)).toBeGreaterThanOrEqual(Date.parse(record.lastLimit.reportedAt));
    expect(record.usage.lastGood.five_hour.utilization).toBe(100);
    expect(existsSync(dir)).toBe(false);
  });

  test("a Record whose Reading already confirmed the Limit makes no request; the Window carries over", async () => {
    const resetsAt = ahead(2 * H);
    const a = h.plantAccount({
      alias: "a",
      active: true,
      usage: reading({ session: 100, sessionResetsAt: resetsAt, age: 5_000 }),
      lastLimit: { reportedAt: ago(20_000), sessionId: "first", window: "five_hour", resetsAt },
    });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    h.scenario({ default: { hooks: [{ event: "StopFailure", payload: { error: "rate_limit", last_assistant_message: WALL } }] } });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(0);
    const record = h.readRecord(a);
    expect(record.lastLimit.sessionId).toBe(flag(h.launches()[0]!.argv, "--session-id"));
    expect(Date.parse(record.lastLimit.reportedAt)).toBeGreaterThan(Date.now() - 20_000);
    expect(record.lastLimit.window).toBe("five_hour");
    expect(record.lastLimit.resetsAt).toBe(resetsAt);
  });

  test("a StopFailure with agent_id is a Limit", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const weekReset = ahead(3 * DAY);
    await h.startUsage({ default: { body: usageBody({ session: 50, scoped: [{ name: "Opus", percent: 100, resetsAt: weekReset }] }) } });
    h.scenario({ default: { hooks: [{ event: "StopFailure", payload: { error: "rate_limit", agent_id: "agent-7", last_assistant_message: "You've hit your Opus limit · resets 3:45pm" } }] } });
    await h.run(["-p", "hi"]);
    const record = h.readRecord(a);
    expect(record.lastLimit).not.toBeNull();
    expect(record.lastLimit.window).toBe("Opus");
    expect(record.lastLimit.resetsAt).toBe(weekReset);
  });

  test("a StopFailure with another error is not", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    h.scenario({ default: { hooks: [{ event: "StopFailure", payload: { error: "other", last_assistant_message: WALL } }] } });
    await h.run(["-p", "hi"]);
    expect(h.readRecord(a).lastLimit).toBeNull();
    expect(usage.requests).toHaveLength(0);
  });

  test("a SessionStart with a new session id (/clear) is tracked: a following StopFailure with it still records", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    h.scenario({
      default: {
        hooks: [
          { event: "SessionStart", payload: { source: "clear", session_id: "after-clear" } },
          { event: "StopFailure", afterMs: 50, payload: { error: "rate_limit", session_id: "after-clear", last_assistant_message: WALL } },
        ],
      },
    });
    await h.run(["-p", "hi"]);
    const record = h.readRecord(a);
    expect(record.lastLimit.sessionId).toBe("after-clear");
    expect(record.lastLimit.window).toBe("five_hour");
  });

  test("an unnamed Limit whose poll fails stays on the Record with no Window", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const usage = await h.startUsage({ default: { status: 500, body: {} } });
    h.scenario({ default: { hooks: [{ event: "StopFailure", payload: { error: "rate_limit", last_assistant_message: "You've hit your usage limit" } }] } });
    await h.run(["-p", "hi"]);
    expect(usage.requests).toHaveLength(1);
    const record = h.readRecord(a);
    expect(record.lastLimit.window).toBeNull();
    expect(record.lastLimit.resetsAt).toBeNull();
    expect(record.usage.lastGood.five_hour.utilization).toBe(50);
  });
});

describe("the Signal dir sweep", () => {
  test("removes a limits/ dir whose newest file is older than 7 days and keeps a fresh one", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const old = join(limitsDir(), "old-session");
    const fresh = join(limitsDir(), "fresh-session");
    mkdirSync(old, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    writeFileSync(join(old, "settings.json"), "{}");
    writeFileSync(join(fresh, "settings.json"), "{}");
    const then = new Date(Date.now() - 8 * DAY);
    utimesSync(join(old, "settings.json"), then, then);
    utimesSync(old, then, then);
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("an old dir with one recent file is kept", async () => {
    h.plantAccount({ active: true, usage: reading() });
    const dir = join(limitsDir(), "busy-session");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), "{}");
    writeFileSync(join(dir, "SessionStart-1.json"), "{}");
    const then = new Date(Date.now() - 8 * DAY);
    utimesSync(join(dir, "settings.json"), then, then);
    utimesSync(dir, then, then);
    await h.run(["-p", "hi"]);
    expect(existsSync(dir)).toBe(true);
  });
});

describe("list shows a live Limit", () => {
  function stateOf(stdout: string, alias: string): string {
    const line = stdout.split("\n").find((l) => l.includes(`  ${alias}  `))!;
    return line.split(/\s{2,}/).at(-1)!;
  }

  test("limit <window>, or limit while unnamed, between disabled and unknown", async () => {
    h.plantAccount({ alias: "named", active: true, usage: reading({ session: 100 }), lastLimit: { reportedAt: ago(MIN), sessionId: "s", window: "five_hour", resetsAt: ahead(H) } });
    h.plantAccount({ alias: "unnamed", usage: reading({ session: 100 }), lastLimit: { reportedAt: ago(MIN), sessionId: "s", window: null, resetsAt: null } });
    h.plantAccount({ alias: "off", disabled: true, usage: reading({ session: 100 }), lastLimit: { reportedAt: ago(MIN), sessionId: "s", window: "five_hour", resetsAt: ahead(H) } });
    h.plantAccount({ alias: "expired", lastLimit: { reportedAt: ago(6 * H), sessionId: "s", window: null, resetsAt: null } });
    const r = await h.run(["account", "list"]);
    expect(r.exitCode).toBe(0);
    expect(stateOf(r.stdout, "named")).toBe("limit five_hour");
    expect(stateOf(r.stdout, "unnamed")).toBe("limit");
    expect(stateOf(r.stdout, "off")).toBe("disabled");
    expect(stateOf(r.stdout, "expired")).toBe("unknown");
    const json = JSON.parse((await h.run(["account", "list", "--json"])).stdout);
    expect(json.accounts.find((x: any) => x.alias === "named").state).toBe("limit five_hour");
  });

  test("a later Reading still at 100 keeps the Limit; one under 100 with a Reset clears it", async () => {
    const still = h.plantAccount({ alias: "still", active: true, usage: reading({ session: 100, age: 5 * MIN }), lastLimit: { reportedAt: ago(MIN), sessionId: "s", window: "five_hour", resetsAt: ahead(H) } });
    const open = h.plantAccount({ alias: "open", usage: reading({ session: 100, age: 5 * MIN }), lastLimit: { reportedAt: ago(MIN), sessionId: "s", window: "five_hour", resetsAt: ahead(H) } });
    await h.startUsage({ byToken: { [token(still)]: { body: usageBody({ session: 100 }) }, [token(open)]: { body: usageBody({ session: 40 }) } } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    expect(stateOf(r.stdout, "still")).toBe("limit five_hour");
    expect(stateOf(r.stdout, "open")).toBe("ok");
    expect(h.readRecord(still).lastLimit.window).toBe("five_hour");
  });
});
