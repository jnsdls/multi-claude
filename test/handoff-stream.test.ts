// Handoff under a stream-json host (ADR 0006, ADR 0009): mclaude pipes the
// host's stdin, the fake claude logs what reaches each child, and the second
// child's log shows the resend once followed by the lines the host wrote
// during the swap, minus a retry of the rejected prompt.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

/** What the Agent SDK writes: an initialize control request, then user messages with the host's own fields. */
const INIT = JSON.stringify({
  type: "control_request",
  request_id: "req-1",
  request: { subtype: "initialize", hooks: {} },
});
const hostUser = (text: string) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: "host-sid",
  });
const OTHER = hostUser("and then run the tests");

const SDK_ARGS = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--settings",
  '{"alwaysThinkingEnabled":false}',
];

async function plantPair() {
  const a = h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
  const b = h.plantAccount({ alias: "b", usage: reading({ session: 10 }) });
  await h.startUsage({
    byToken: { [token(a)]: { body: usageBody({ session: 100 }) }, [token(b)]: { body: usageBody({ session: 10 }) } },
  });
  return { a, b };
}

/** The first child: echoes stdin, writes the transcript, walls after `afterMs`, then lingers. */
function walled(transcript: unknown[], afterMs = 800): CallBehaviour {
  return {
    echoStdin: true,
    transcript: { path: join(h.root, "transcript.jsonl"), lines: transcript },
    hooks: [{ event: "StopFailure", afterMs, payload: { error: "rate_limit", last_assistant_message: WALL } }],
    sleepMs: 10_000,
  };
}

function write(p: ReturnType<Harness["spawn"]>, ...lines: string[]): void {
  const sink = p.stdin as { write(s: string): unknown; flush(): unknown };
  sink.write(`${lines.join("\n")}\n`);
  sink.flush();
}

describe("Handoff under a stream-json host", () => {
  test("pipes stdin, resends the rejected turn once, then the queued lines minus the retry", async () => {
    const { a, b } = await plantPair();
    h.scenario({ calls: [walled(PRE_TURN), { echoStdin: true, exitAfterStdinLines: 2, sleepMs: 10_000, exit: 0 }] });
    const p = h.spawn(SDK_ARGS, { stdin: "pipe" });
    write(p, INIT, hostUser(PROMPT));
    expect(await h.waitFor(() => h.launches()[0]?.stdinLines?.length === 2)).toBe(true);
    // The SDK's inline --settings survived the merge: the file holds its key and the hook entries.
    const settings = JSON.parse(readFileSync(flag(h.launches()[0]!.argv, "--settings")!, "utf8"));
    expect(settings.alwaysThinkingEnabled).toBe(false);
    expect(settings.hooks.StopFailure[0].matcher).toBe("rate_limit");
    expect(settings.hooks.SessionStart).toHaveLength(1);

    // The Record carries the Limit from the moment mclaude takes the Signal, and host lines queue from then on.
    expect(await h.waitFor(() => h.readRecord(a).lastLimit !== null, 10_000)).toBe(true);
    write(p, hostUser(PROMPT), OTHER);

    expect(await h.waitFor(() => h.launches()[1]?.exitedOnStdin === true, 10_000)).toBe(true);
    const [l0, l1] = h.launches() as [any, any];
    expect(l0.stdinLines).toEqual([INIT, hostUser(PROMPT)]);
    expect(l1.stdinLines).toEqual([hostUser(PROMPT), OTHER]);

    expect(flag(l1.argv, "--resume")).toBe(flag(l0.argv, "--session-id"));
    expect(l1.argv).not.toContain("--session-id");
    expect(l1.argv).not.toContain(PROMPT);
    expect(flag(l1.argv, "--settings")).toBe(flag(l0.argv, "--settings"));
    expect(l1.argv.at(-2)).toBe("--settings");
    expect(l1.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(b));

    const stderr = await new Response(p.stderr as ReadableStream).text();
    await p.exited;
    expect(p.exitCode).toBe(0);
    expect(stderr.trim().split("\n")).toEqual(["mclaude: usage limit on a; continuing on b"]);
  }, 20_000);

  test("a mid-turn wall sends the nudge as a user message the host never wrote", async () => {
    await plantPair();
    h.scenario({ calls: [walled(MID_TURN), { echoStdin: true, exitAfterStdinLines: 1, sleepMs: 10_000, exit: 0 }] });
    const p = h.spawn(SDK_ARGS, { stdin: "pipe" });
    write(p, INIT, hostUser(PROMPT));
    expect(await h.waitFor(() => h.launches()[1]?.exitedOnStdin === true, 10_000)).toBe(true);
    expect(h.launches()[1]!.stdinLines).toEqual([
      JSON.stringify({ type: "user", message: { role: "user", content: NUDGE } }),
    ]);
    await p.exited;
    expect(p.exitCode).toBe(0);
  }, 20_000);

  test("a host that closed stdin before the swap gets the resend and then end-of-file", async () => {
    await plantPair();
    h.scenario({ calls: [walled(PRE_TURN), { echoStdin: true, waitForStdinClose: true, exit: 0 }] });
    const p = h.spawn(SDK_ARGS, { stdin: "pipe" });
    write(p, INIT, hostUser(PROMPT));
    expect(await h.waitFor(() => h.launches()[0]?.stdinLines?.length === 2)).toBe(true);
    (p.stdin as { end(): unknown }).end();
    expect(await h.waitFor(() => h.launches()[1]?.stdinClosed === true, 10_000)).toBe(true);
    expect(h.launches()[1]!.stdinLines).toEqual([hostUser(PROMPT)]);
    await p.exited;
    expect(p.exitCode).toBe(0);
  }, 20_000);

  test("without a Handoff the pipe is transparent: every line reaches the child and end-of-file ends it", async () => {
    h.plantAccount({ alias: "a", active: true, usage: reading({ session: 50 }) });
    h.scenario({ default: { echoStdin: true, waitForStdinClose: true, exit: 0 } });
    const p = h.spawn(SDK_ARGS, { stdin: "pipe" });
    write(p, INIT, hostUser("one"), hostUser("two"));
    (p.stdin as { end(): unknown }).end();
    await p.exited;
    expect(p.exitCode).toBe(0);
    expect(h.launches()).toHaveLength(1);
    expect(h.launches()[0]!.stdinLines).toEqual([INIT, hostUser("one"), hostUser("two")]);
  });
});
