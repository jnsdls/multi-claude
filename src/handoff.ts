// Handoff (ADR 0007, ADR 0009): after a Limit is on the Record, run plain
// Selection over every Account including the one being left, end the child,
// and relaunch `--resume` on the target with the rejected turn sent again. In
// the TUI the resend rides on the positional prompt; under a stream-json host
// it goes into the new child's stdin ahead of the lines the host wrote during
// the swap (ADR 0006).
import { existsSync, readFileSync, statSync } from "node:fs";
import type { Subprocess } from "bun";
import { relaunchArgv } from "./argv.ts";
import type { Signal } from "./hook.ts";
import type { Chosen, LiveSession } from "./launch.ts";
import { warn } from "./log.ts";
import { accountDir } from "./paths.ts";
import { mergeProjectApprovals } from "./prefs.ts";
import { listRecords, readActiveId, type AccountRecord } from "./record.ts";
import { fallback, select } from "./selection.ts";
import { userMessageLine, userTextOfLine } from "./stdin-pump.ts";
import { resendFor, type Resend } from "./transcript.ts";

/** The transcript is settled after this many equal mtime readings, 100 ms apart. */
export const SETTLE_READINGS = 3;
export const SETTLE_STEP_MS = 100;
export const SETTLE_CAP_MS = 3_000;
/** SIGTERM gets this long before SIGKILL. The TUI exits in under a second. */
export const TERM_TIMEOUT_MS = 2_000;
/** What a clean claude exit writes; sent after a SIGKILL, which leaves the tty raw. */
export const TERMINAL_RESET = "\x1b[?1049l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[0m";

/**
 * The Account the session moves to, or null to leave the child alive. Plain
 * Selection with the launch's model and threshold; Exhausted takes the
 * Unknown and Credits tiers of Fallback only, since the Reset tier is the wall
 * the child is already waiting at.
 */
export function chooseHandoffTarget(live: LiveSession, records: AccountRecord[], now: number): { chosen: Chosen; reason: string | null } | null {
  const current = live.chosen.record.id;
  const selection = select({ records, activeId: readActiveId(), model: live.model, threshold: live.threshold, now });
  if (selection.kind === "move" && selection.id !== current) {
    return { chosen: { record: selection.record, dir: accountDir(selection.id), makeActive: true, source: "selection" }, reason: null };
  }
  if (selection.kind !== "exhausted") return null;
  if (live.ctx.settings.onExhausted === "fail") return null;
  const fb = fallback(records, live.model, now);
  if (!fb || fb.record.id === current || fb.tier === "reset") return null;
  const reason = fb.tier === "unknown" ? "its usage is unknown" : "using extra usage credits";
  return { chosen: { record: fb.record, dir: accountDir(fb.record.id), makeActive: false, source: "fallback" }, reason };
}

/** Polls the transcript's mtime until three consecutive readings agree, capped. A missing path just proceeds. */
export async function waitForTranscript(path: string | undefined): Promise<void> {
  if (!path) return;
  const t0 = Date.now();
  let last = Number.NaN;
  let stable = 0;
  while (Date.now() - t0 < SETTLE_CAP_MS) {
    let mtime: number;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      return;
    }
    if (mtime === last) {
      if (++stable >= SETTLE_READINGS) return;
    } else {
      stable = 0;
      last = mtime;
    }
    await Bun.sleep(SETTLE_STEP_MS);
  }
}

function exited(child: Subprocess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** SIGTERM, then SIGKILL after the timeout. Returns whether the SIGKILL was needed. */
export async function endChild(child: Subprocess): Promise<boolean> {
  if (exited(child)) return false;
  try {
    child.kill("SIGTERM");
  } catch {
    return false;
  }
  const term = await Promise.race([child.exited.then(() => true), Bun.sleep(TERM_TIMEOUT_MS).then(() => false)]);
  if (term) return false;
  try {
    child.kill("SIGKILL");
  } catch {
    // Died between the check and the kill.
  }
  await child.exited;
  return true;
}

/** After a SIGKILL the tty is still raw; put it back the way claude's own exit would. */
export function resetTerminal(): void {
  if (process.stdout.isTTY) process.stdout.write(TERMINAL_RESET);
  if (process.stdin.isTTY) {
    try {
      Bun.spawnSync(["stty", "sane"], { stdin: "inherit", stdout: "ignore", stderr: "ignore" });
    } catch {
      // No stty on PATH; the relaunched claude re-initialises the terminal itself.
    }
  }
}

function readTranscript(path: string | undefined): string | null {
  if (!path || !existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * The line the resend enters a stream-json child as: the host's own user line
 * when the resend is that message verbatim (so `parent_tool_use_id` and
 * `session_id` match what the host sent), else a fresh user message.
 */
export function resendLine(resend: Resend, hostLine: string | null): string {
  if (resend.kind === "verbatim" && hostLine) return hostLine;
  return userMessageLine(resend.text);
}

/**
 * One Handoff. Runs after the Limit is recorded and while `live.handingOff`
 * is up, so a second Signal from the dying child is ignored; the caller lowers
 * the flag when this returns. Leaves the child alive when Selection has
 * nowhere to send it.
 */
export async function runHandoff(signal: Signal, _record: AccountRecord, live: LiveSession): Promise<void> {
  const from = live.chosen;
  const child = live.child;
  if (!child) return;
  const target = chooseHandoffTarget(live, listRecords(), Date.now());
  if (!target) {
    warn(`usage limit on ${from.record.alias}; no account to hand off to, staying`);
    live.pump?.attach(child);
    return;
  }
  const transcriptPath = typeof signal.payload.transcript_path === "string" ? signal.payload.transcript_path : undefined;
  const cwd = typeof signal.payload.cwd === "string" ? signal.payload.cwd : process.cwd();

  await waitForTranscript(transcriptPath);
  if (await endChild(child)) resetTerminal();
  const resend = resendFor(readTranscript(transcriptPath));
  await mergeProjectApprovals(from.dir, target.chosen.dir, cwd);

  const tail = target.reason ? `; ${target.reason}` : "";
  warn(`usage limit on ${from.record.alias}; continuing on ${target.chosen.record.alias}${tail}`);
  const argv = relaunchArgv(live.ctx.forwarded, live.sessionId, live.plan.settingsPath, live.pump ? null : resend.text);
  const next = await live.launch(target.chosen, argv);
  live.pump?.attach(next, { first: resendLine(resend, live.pump.userLineFor(resend.text)), drop: (line) => userTextOfLine(line) === resend.text });
}
