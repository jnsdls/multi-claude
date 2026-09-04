// Handoff in the TUI at the process seam (ADR 0007, ADR 0009): the fake claude
// fires the Limit hook, mclaude ends it and relaunches `--resume` on the Account
// Selection picked with the rejected turn as the prompt. Observed through the
// fake's call records, files under MCLAUDE_HOME and the Account dirs, and
// mclaude's own exit.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { Harness, usageBody, type CallBehaviour } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const WALL = "You've hit your session limit · resets 3:45pm";
const PROMPT = "please refactor the parser";
const NUDGE = "Continue from where you left off. The previous attempt stopped at a usage limit.";
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

const user = (content: unknown) => ({ type: "user", message: { role: "user", content } });
const assistant = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { role: "assistant", content },
  ...extra,
});
const errorEntry = () => assistant([{ type: "text", text: WALL }], { isApiErrorMessage: true, error: "rate_limit" });
const PRE_TURN = [user(PROMPT), errorEntry()];
const MID_TURN = [
  user(PROMPT),
  assistant([{ type: "tool_use", id: "t1", name: "Read", input: {} }]),
  user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
  errorEntry(),
];

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function liveMarkers(dir: string): string[] {
  const run = join(dir, ".mclaude", "run");
  if (!existsSync(run)) return [];
  return readdirSync(run).filter((n) => pidAlive(Number(n)));
}

/** Two Accounts: a is Active and walls, b has room. The usage server answers a with a full session Window. */
async function plantPair(b: Parameters<typeof usageBody>[0] = { session: 10 }) {
  const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
  const bId = h.plantAccount({ alias: "b", usage: reading(b) });
  await h.startUsage({
    byToken: { [token(a)]: { body: usageBody({ session: 100 }) }, [token(bId)]: { body: usageBody(b) } },
  });
  return { a, b: bId };
}

const limitHook = (payload: Record<string, unknown> = {}) => ({
  event: "StopFailure" as const,
  afterMs: 100,
  payload: { error: "rate_limit", last_assistant_message: WALL, ...payload },
});

/** The first child: writes the transcript, fires SessionStart then the Limit, then lingers. */
function walled(transcript: unknown[], extra: Partial<CallBehaviour> = {}): CallBehaviour {
  return {
    transcript: { path: join(h.root, "transcript.jsonl"), lines: transcript },
    hooks: [{ event: "SessionStart", payload: { source: "startup" } }, limitHook()],
    sleepMs: 10_000,
    ...extra,
  };
}

async function waitForRelaunch(): Promise<void> {
  expect(await h.waitFor(() => h.launches().length === 2, 10_000)).toBe(true);
}

describe("Handoff in the TUI", () => {
  test("ends the child, resumes on b with the rejected turn as the prompt, mirrors the new child's exit", async () => {
    const { a, b } = await plantPair();
    h.scenario({ calls: [walled(PRE_TURN), { exit: 3, sleepMs: 1000 }] });
    const p = h.spawn(["--model", "sonnet"]);
    await waitForRelaunch();
    const [l0, l1] = h.launches() as [any, any];

    // The first child was killed while the second came up: it never reached its own exit.
    expect(l0.exitedAt).toBeUndefined();
    expect(l1.startedAt).toBeGreaterThan(l0.startedAt);
    expect(await h.waitFor(() => !pidAlive(l0.pid))).toBe(true);

    const sid = flag(l0.argv, "--session-id")!;
    expect(l1.argv.slice(0, 2)).toEqual(["--model", "sonnet"]);
    expect(flag(l1.argv, "--resume")).toBe(sid);
    expect(flag(l1.argv, "--settings")).toBe(flag(l0.argv, "--settings"));
    expect(l1.argv).not.toContain("--session-id");
    expect(l1.argv.at(-1)).toBe(PROMPT);
    expect(l1.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(b));
    expect(l1.env.MCLAUDE_LIMIT_DIR).toBe(l0.env.MCLAUDE_LIMIT_DIR);
    expect(l1.env.MCLAUDE_ACCOUNT).toBe(b);
    expect(h.readActive()).toBe(b);
    expect(h.readRecord(a).lastLimit.window).toBe("five_hour");

    // Signal to relaunch, loosely: under five seconds.
    const dir = l0.env.MCLAUDE_LIMIT_DIR!;
    const signalFile = readdirSync(dir).find((f) => f.startsWith("StopFailure-"))!;
    expect(l1.startedAt - statSync(join(dir, signalFile)).mtimeMs).toBeLessThan(5000);

    // The Run marker moved with the relaunch.
    expect(liveMarkers(h.accountDir(a))).toEqual([]);
    expect(liveMarkers(h.accountDir(b))).toHaveLength(1);

    const stderr = await new Response(p.stderr as ReadableStream).text();
    await p.exited;
    expect(p.exitCode).toBe(3);
    expect(stderr.trim().split("\n")).toEqual(["mclaude: usage limit on a; continuing on b"]);
    expect(existsSync(dir)).toBe(false);
    expect(liveMarkers(h.accountDir(b))).toEqual([]);
  });

  test("a child that ignores SIGTERM is SIGKILLed and the relaunch still happens", async () => {
    await plantPair();
    h.scenario({ calls: [walled(PRE_TURN, { ignoreSigterm: true }), { exit: 0 }] });
    const p = h.spawn([]);
    await waitForRelaunch();
    const l0 = h.launches()[0]!;
    expect(l0.sawSigterm).toBe(true);
    expect(await h.waitFor(() => !pidAlive(l0.pid))).toBe(true);
    await p.exited;
    expect(p.exitCode).toBe(0);
  }, 15_000);

  test("a mid-turn wall sends the nudge", async () => {
    await plantPair();
    h.scenario({ calls: [walled(MID_TURN), { exit: 0 }] });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(h.launches()[1]!.argv.at(-1)).toBe(NUDGE);
    await p.exited;
  });

  test("a dangling user message with no error entry is resent verbatim", async () => {
    await plantPair();
    h.scenario({ calls: [walled([user(PROMPT), errorEntry(), user("retry of the prompt")]), { exit: 0 }] });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(h.launches()[1]!.argv.at(-1)).toBe("retry of the prompt");
    await p.exited;
  });

  test("a subagent wall triggers Handoff at once", async () => {
    await plantPair();
    h.scenario({
      calls: [walled(PRE_TURN, { hooks: [limitHook({ agent_id: "agent-7", agent_type: "Explore" })] }), { exit: 0 }],
    });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(flag(h.launches()[1]!.argv, "--resume")).toBeDefined();
    await p.exited;
  });

  test("nobody has Headroom: the child is left alive and exits on its own", async () => {
    const { a } = await plantPair({ session: 100 });
    h.scenario({ calls: [walled(PRE_TURN, { sleepMs: 1000, exit: 0 })] });
    const r = await h.run([]);
    expect(r.exitCode).toBe(0);
    expect(h.launches()).toHaveLength(1);
    expect(h.launches()[0]!.exitedAt).toBeDefined();
    expect(h.readRecord(a).lastLimit.window).toBe("five_hour");
    expect(h.readActive()).toBe(a);
    expect(r.stderr.trim().split("\n")).toEqual(["mclaude: usage limit on a; no account to hand off to, staying"]);
  });

  test("Exhausted with a Credits Account falls back to it without moving active", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const c = h.plantAccount({ alias: "c", usage: reading({ session: 100, credits: true }) });
    await h.startUsage({ byToken: { [token(a)]: { body: usageBody({ session: 100 }) } } });
    h.scenario({ calls: [walled(PRE_TURN), { exit: 0 }] });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(h.launches()[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(c));
    expect(h.readActive()).toBe(a);
    const stderr = await new Response(p.stderr as ReadableStream).text();
    await p.exited;
    expect(stderr.trim()).toBe("mclaude: usage limit on a; continuing on c; using extra usage credits");
  });

  test("Selection moves to an Unknown Account as the probe, and that one becomes active", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const c = h.plantAccount({ alias: "c" });
    await h.startUsage({ default: { body: usageBody({ session: 100 }) } });
    h.scenario({ calls: [walled(PRE_TURN), { exit: 0 }] });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(h.launches()[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(c));
    expect(h.readActive()).toBe(c);
    await p.exited;
  });

  test("after /clear the relaunch resumes the new session id", async () => {
    await plantPair();
    h.scenario({
      calls: [
        walled(PRE_TURN, {
          hooks: [
            { event: "SessionStart", payload: { source: "clear", session_id: "after-clear" } },
            limitHook({ session_id: "after-clear" }),
          ],
        }),
        { exit: 0 },
      ],
    });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(flag(h.launches()[1]!.argv, "--resume")).toBe("after-clear");
    await p.exited;
  });

  test("a second Limit Signal from the dying child is ignored", async () => {
    await plantPair();
    h.scenario({
      calls: [walled(PRE_TURN, { hooks: [limitHook(), { ...limitHook(), afterMs: 50 }] }), { exit: 0, sleepMs: 1000 }],
    });
    const p = h.spawn([]);
    await waitForRelaunch();
    const dir = h.launches()[0]!.env.MCLAUDE_LIMIT_DIR!;
    expect(readdirSync(dir).filter((f) => f.startsWith("StopFailure-"))).toHaveLength(2);
    await p.exited;
    expect(p.exitCode).toBe(0);
    expect(h.launches()).toHaveLength(2);
  });

  test("carries the project's approvals from a into b", async () => {
    const project = realpathSync(h.root);
    const a = h.plantAccount({
      alias: "a",
      active: true,
      usage: reading({ session: 50 }),
      claudeJson: { projects: { [project]: { hasTrustDialogAccepted: true, enabledMcpjsonServers: ["one"] } } },
    });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 10 }) });
    await h.startUsage({
      byToken: { [token(a)]: { body: usageBody({ session: 100 }) }, [token(b)]: { body: usageBody({ session: 10 }) } },
    });
    h.scenario({ calls: [walled(PRE_TURN), { exit: 0 }] });
    const p = h.spawn([]);
    await waitForRelaunch();
    expect(h.launches()[0]!.cwd).toBe(project);
    await p.exited;
    const copy = JSON.parse(readFileSync(join(h.accountDir(b), ".claude.json"), "utf8"));
    expect(copy.projects[project]).toEqual({ hasTrustDialogAccepted: true, enabledMcpjsonServers: ["one"] });
    expect(copy.oauthAccount.accountUuid).toBe(`acc-${b}`);
  });

  test("a -p child that walls and exits on its own is handed off after its exit, and the last child's exit is mirrored", async () => {
    await plantPair();
    // The first child fires the Limit and exits 0 at once; the second lingers so the Signal dir can be seen alive under it.
    h.scenario({
      calls: [
        { hooks: [limitHook()], exit: 0 },
        { exit: 3, sleepMs: 1500 },
      ],
    });
    const p = h.spawn(["-p", PROMPT]);
    await waitForRelaunch();
    const [l0, l1] = h.launches() as [any, any];
    expect(l0.exitedAt).toBeDefined();
    expect(l1.startedAt).toBeGreaterThanOrEqual(l0.exitedAt);
    const dir = l0.env.MCLAUDE_LIMIT_DIR!;
    expect(existsSync(dir)).toBe(true);
    expect(flag(l1.argv, "--resume")).toBe(flag(l0.argv, "--session-id"));
    expect(l1.argv.at(-1)).toBe(NUDGE);
    const stderr = await new Response(p.stderr as ReadableStream).text();
    await p.exited;
    expect(p.exitCode).toBe(3);
    expect(h.launches()).toHaveLength(2);
    expect(existsSync(dir)).toBe(false);
    expect(stderr.trim().split("\n")).toEqual(["mclaude: usage limit on a; continuing on b"]);
  });

  test("Selection is anchored on the Account the child runs on, not on `active`: a Fallback launch's child still moves", async () => {
    const { a, b } = await plantPair();
    h.scenario({ calls: [walled(PRE_TURN, { hooks: [{ ...limitHook(), afterMs: 800 }] }), { exit: 0 }] });
    const p = h.spawn([]);
    expect(await h.waitFor(() => h.launches().length === 1)).toBe(true);
    expect(h.launches()[0]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(a));
    // Another launch (or a Fallback one) moved the pointer while this child ran.
    h.setActive(b);
    await waitForRelaunch();
    expect(h.launches()[1]!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(b));
    const stderr = await new Response(p.stderr as ReadableStream).text();
    await p.exited;
    expect(stderr.trim().split("\n")).toEqual(["mclaude: usage limit on a; continuing on b"]);
  });

  test("a Limit on the relaunched child starts a new Handoff", async () => {
    const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    const b = h.plantAccount({ alias: "b", usage: reading({ session: 10 }) });
    const c = h.plantAccount({ alias: "c", usage: reading({ session: 20 }) });
    await h.startUsage({
      byToken: {
        [token(a)]: { body: usageBody({ session: 100 }) },
        [token(b)]: { body: usageBody({ session: 100 }) },
        [token(c)]: { body: usageBody({ session: 20 }) },
      },
    });
    h.scenario({ calls: [walled(PRE_TURN), walled(PRE_TURN, { hooks: [limitHook()] }), { exit: 0 }] });
    const p = h.spawn([]);
    expect(await h.waitFor(() => h.launches().length === 3, 15_000)).toBe(true);
    const dirs = h.launches().map((l) => l.env.CLAUDE_CONFIG_DIR);
    expect(dirs).toEqual([h.accountDir(a), h.accountDir(b), h.accountDir(c)]);
    await p.exited;
    expect(p.exitCode).toBe(0);
    expect(h.readActive()).toBe(c);
  }, 20_000);
});
