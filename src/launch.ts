// Passthrough: everything whose first word is not a Reserved word. Chooses the
// Account, builds the child environment, spawns claude with inherited stdio and
// mirrors its exit. Session starts additionally run Selection and carry the Limit
// hook; the pieces those need plug in here.
import { existsSync } from "node:fs";
import type { Subprocess } from "bun";
import { classify, isStreamJsonInput, scanArgv, stripOwnFlags, type OwnFlags, type Scan } from "./argv.ts";
import { resolveClaude } from "./claude-path.ts";
import { loadConfigFile, resolveSettings, type Settings } from "./config.ts";
import { needsLogin, readCredential } from "./credential.ts";
import { buildChildEnv } from "./env.ts";
import { EXIT, ExitError } from "./exit.ts";
import { runHandoff } from "./handoff.ts";
import { warn } from "./log.ts";
import { accountDir } from "./paths.ts";
import { syncPreferences } from "./prefs.ts";
import { limitTrustedUntil, liveLimit, recordLimit } from "./limit.ts";
import { resolveRequestedModel } from "./model.ts";
import {
  listOrphans,
  listRecords,
  readActiveId,
  readPinnedId,
  readRecord,
  resolveAccount,
  writeActiveId,
  type AccountRecord,
} from "./record.ts";
import { writeRunMarker } from "./runmarker.ts";
import { exitLike, forwardSignals, runCaptured, spawnClaude } from "./spawn.ts";
import { earliestWall, fallback, refreshOrder, select, type Selection } from "./selection.ts";
import {
  cleanupSignalDir,
  injectSessionArgv,
  prepareSession,
  sessionIdFor,
  sweepSignalDirs,
  watchSignals,
  type SessionPlan,
} from "./signal.ts";
import { startStdinPump, type StdinPump } from "./stdin-pump.ts";
import { runSymlinkFarm } from "./symlink-farm.ts";
import { pollAccount, pollMany } from "./usage.ts";
import { compareVersions, parseVersion, VERSION, VERSION_FLOOR } from "./version.ts";
import {
  ACTIVE_STALE_MS,
  applicableWindows,
  CANDIDATE_CONCURRENCY,
  isFresh,
  LAUNCH_TIMEOUT_MS,
  maxUtilization,
  readingStands,
} from "./windows.ts";

export const HELP_FOOTER = [
  "mclaude: runs Claude Code under the Account with headroom. Reserved words: account, version, hook.",
  "mclaude: own flags: --account <id|alias>, --switch-threshold <n>, --on-exhausted <launch|fail>.",
  "mclaude: `mclaude -- <args>` forwards everything after the -- to claude and drops the -- itself.",
].join("\n");

export interface LaunchContext {
  own: OwnFlags;
  forwarded: string[];
  scan: Scan;
  settings: Settings;
  claudePath: string;
}

/** Who named the Account: the order of authority is override, pin, then Selection or the Active account (ADR 0011). */
export type ChosenSource = "selection" | "active" | "pin" | "override" | "fallback";

/** The Account a launch runs on. */
export interface Chosen {
  record: AccountRecord;
  dir: string;
  /** Whether this launch writes `active`. False on a Fallback or Override launch. */
  makeActive: boolean;
  source: ChosenSource;
}

/** A Pin or Override is absolute: no Handoff leaves the Account it named. */
export function handoffAllowedFor(chosen: Chosen): boolean {
  return chosen.source !== "pin" && chosen.source !== "override";
}

export async function runPassthrough(argv: string[], opts: { forced: boolean }): Promise<number> {
  const stripped = opts.forced ? { own: {}, forwarded: argv, errors: [] } : stripOwnFlags(argv);
  if (stripped.errors.length) throw new ExitError(EXIT.USAGE, stripped.errors[0]!);
  const scan = scanArgv(stripped.forwarded);
  const kind = classify(scan);

  // Passthrough reads all three config keys.
  const settings = resolveSettings(stripped.own, loadConfigFile());
  const claudePath = resolveClaude(settings);
  const ctx: LaunchContext = { own: stripped.own, forwarded: stripped.forwarded, scan, settings, claudePath };

  switch (kind) {
    case "version":
      return runVersionFlag(ctx);
    case "auth-refused":
      throw new ExitError(
        EXIT.USAGE,
        `auth ${scan.positionals[1]} is refused: use \`mclaude account add\` and \`mclaude account remove\` so an Account dir never desyncs`,
      );
    case "help":
      return runHelp(ctx);
    case "passthrough":
      return runPlainPassthrough(ctx);
    case "session-start":
      return runSessionStart(ctx);
  }
}

/** `--version`/`-v`: claude's own string on stdout, mclaude's on stderr, same resolved path. */
async function runVersionFlag(ctx: LaunchContext): Promise<number> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const child = spawnClaude(ctx.claudePath, { argv: ctx.forwarded, env });
  await child.exited;
  process.stderr.write(`mclaude ${VERSION}\n`);
  exitLike(child);
}

async function runHelp(ctx: LaunchContext): Promise<number> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const child = spawnClaude(ctx.claudePath, { argv: ctx.forwarded, env });
  await child.exited;
  process.stderr.write(`${HELP_FOOTER}\n`);
  exitLike(child);
}

/** The Active account, or exit 1 with a pointer at `account add`. */
export function requireActiveAccount(): Chosen {
  const id = readActiveId();
  if (!id) {
    throw new ExitError(EXIT.REFUSED, "no Active account. Run `mclaude account add` to log in to one");
  }
  const record = readRecord(id)!;
  return { record, dir: accountDir(id), makeActive: true, source: "active" };
}

/** Maintenance commands run on the Active account with no poll and no Version floor check. */
async function runPlainPassthrough(ctx: LaunchContext): Promise<never> {
  const chosen = await chooseForPlainPassthrough(ctx);
  const child = await spawnOn(ctx, chosen, ctx.forwarded, { limitDir: undefined });
  exitLike(child);
}

/** Override, then Pin, then the Active account. Selection never runs here. */
async function chooseForPlainPassthrough(ctx: LaunchContext): Promise<Chosen> {
  return (await chooseNamed(ctx, null)) ?? requireActiveAccount();
}

/** `--account` over `MCLAUDE_USE_ACCOUNT`. `MCLAUDE_ACCOUNT` is what mclaude sets on the child and is never read. */
function overrideName(ctx: LaunchContext): string | null {
  return ctx.own.account || process.env.MCLAUDE_USE_ACCOUNT || null;
}

/**
 * The Account an Override or a Pin names, or null when neither is in force so
 * the caller falls through to its own rule. Never polls: the name is the
 * order, whatever the Record says. A pinned id with no Record and no dir is a
 * dangling pointer and exits 1 pointing at `account unpin`; a Pin never falls
 * through to Selection. `session` carries the Requested model at a Session
 * start and is null on a plain Passthrough, where no Limit check applies.
 */
async function chooseNamed(ctx: LaunchContext, session: { model: string | null } | null): Promise<Chosen | null> {
  const override = overrideName(ctx);
  if (override) return checkNamed(ctx, resolveNamed(override, "override"), "override", session, override);
  const pinned = readPinnedId();
  if (!pinned) return null;
  const record = resolveAccount(pinned);
  if (!record) {
    if (listOrphans().includes(pinned)) return checkNamed(ctx, null, "pin", session, pinned);
    throw new ExitError(EXIT.REFUSED, `pinned Account ${pinned} does not exist. Run \`mclaude account unpin\``);
  }
  return checkNamed(ctx, record, "pin", session);
}

/** Unknown name exit 64. An Orphan resolves to null and the caller exits 1. */
function resolveNamed(name: string, source: "override" | "pin"): AccountRecord | null {
  const record = resolveAccount(name);
  if (record) return record;
  if (listOrphans().includes(name)) return null;
  throw new ExitError(EXIT.USAGE, `no Account named "${name}" for ${source === "override" ? "--account" : "the pin"}`);
}

/**
 * The checks a named Account passes before its launch (ADR 0011). An Orphan
 * or Needs login exits 1 rather than falling through to Selection; Disabled
 * launches with one line; a live Limit for the Requested model launches with
 * one line, or exits 75 under onExhausted=fail. Past the threshold: silent.
 */
async function checkNamed(
  ctx: LaunchContext,
  record: AccountRecord | null,
  source: "override" | "pin",
  session: { model: string | null } | null,
  orphanId?: string,
): Promise<Chosen> {
  const by = source === "override" ? "--account" : "the pin";
  if (!record) {
    throw new ExitError(
      EXIT.REFUSED,
      `${orphanId} is an Orphan with no Record; ${by} cannot launch it. Run \`mclaude account remove ${orphanId}\``,
    );
  }
  const who = `${record.alias} (${record.id})`;
  const dir = accountDir(record.id);
  if (needsLogin(await readCredential(dir))) {
    throw new ExitError(
      EXIT.REFUSED,
      `${who} needs login; ${by} cannot launch it. Run \`mclaude account login ${record.alias}\``,
    );
  }
  if (record.disabled) warn(`${who} is Disabled; launching on it anyway under ${by}`);
  const now = Date.now();
  const limit = session ? liveLimit(record, session.model, now) : null;
  if (limit) {
    const resetsAt = limit.resetsAt ?? new Date(limitTrustedUntil(record, limit)).toISOString();
    if (ctx.settings.onExhausted === "fail")
      throw new ExitError(EXIT.EXHAUSTED, exhaustedFailLine(record.alias, limit.window, resetsAt));
    warn(`${who} is at its limit; launching on it anyway under ${by}. ${resetsTail(limit.window, resetsAt)}`);
  }
  return { record, dir, makeActive: source === "pin", source };
}

/**
 * A Session start: the Version floor, Selection, then the Limit hook plumbing
 * around the spawn. The watcher starts before the child and stops after it;
 * the Signal dir dies with the launch, after any Limit still being recorded
 * has landed. The exit mirrored is the last child's: a child's exit is
 * followed by one drain of the Signal dir, and when that drain ran a Handoff
 * the new child is the one waited on.
 */
async function runSessionStart(ctx: LaunchContext): Promise<never> {
  await checkVersionFloor(ctx);
  const model = resolveRequestedModel(ctx.scan, process.env, process.cwd());
  const chosen = await chooseForSessionStart(ctx, model);
  if (ctx.scan.bare || ctx.scan.safeMode) {
    warn(`${ctx.scan.bare ? "--bare" : "--safe-mode"} skips hooks, so Handoff is off for this launch`);
  }
  const plan = prepareSession(ctx.scan, sessionIdFor(ctx.scan));
  const injected = injectSessionArgv(
    ctx.forwarded,
    ctx.scan,
    plan.sessionId,
    plan.settingsPath,
    plan.userSettingsUnparseable,
  );
  if (injected.warning) warn(injected.warning);

  const live: LiveSession = {
    ctx,
    chosen,
    plan,
    sessionId: plan.sessionId,
    child: null,
    model,
    threshold: ctx.settings.switchThreshold,
    handoffAllowed: handoffAllowedFor(chosen),
    handingOff: false,
    pump: isStreamJsonInput(ctx.scan) ? startStdinPump() : null,
    launch: (target, argv) => launchLive(live, target, argv),
  };
  const watcher = watchSignals(plan.limitDir, {
    onSessionStart(signal) {
      const id = signal.payload.session_id;
      if (typeof id === "string" && id) live.sessionId = id;
    },
    async onLimit(signal) {
      // One Handoff per Signal: a second Signal from the dying child, and a late
      // one from a child already replaced, are ignored.
      if (live.handingOff) return;
      if (signal.accountId && signal.accountId !== live.chosen.record.id) return;
      // Up from the Signal on: host lines queue until the new child is up, or
      // go back to this one when it is kept.
      live.handingOff = true;
      live.pump?.detach();
      try {
        const record = await recordLimit(live.chosen.record.id, signal, {
          claudePath: ctx.claudePath,
          fallbackSessionId: live.sessionId,
          model: live.model,
        });
        if (record && live.handoffAllowed) await runHandoff(signal, live);
        else {
          if (record)
            warn(
              `usage limit on ${record.alias}; ${live.chosen.source === "pin" ? "pinned" : "--account"} holds, staying`,
            );
          if (live.child) live.pump?.attach(live.child);
        }
      } catch (e) {
        warn(`Handoff failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        live.handingOff = false;
      }
    },
  });
  let child: Subprocess;
  try {
    child = await live.launch(chosen, injected.argv);
    live.pump?.attach(child);
    for (;;) {
      await child.exited;
      await watcher.drain();
      if (live.child === child) break;
      child = live.child!;
    }
  } finally {
    await watcher.stop();
    cleanupSignalDir(plan.limitDir);
  }
  exitLike(child);
}

/** What a running Session start knows about itself; Handoff reads and updates it. */
export interface LiveSession {
  ctx: LaunchContext;
  /** The Account the current child runs on; a Handoff moves it. */
  chosen: Chosen;
  plan: SessionPlan;
  /** The session id claude runs under, updated by every SessionStart Signal (so `/clear` keeps Handoff armed). */
  sessionId: string;
  /** The current claude child, once spawned. */
  child: Subprocess | null;
  /** The Requested model and Switch threshold the launch used; Handoff runs the same Selection. */
  model: string | null;
  threshold: number;
  /** False under a Pin or Override (#60): the Limit is recorded and the child stays. */
  handoffAllowed: boolean;
  /** Up from a Limit Signal until the Handoff it started has finished or bailed. */
  handingOff: boolean;
  /** The stdin pump on the stream-json path; null when the child inherits stdin. */
  pump: StdinPump | null;
  /** Spawns a child on an Account; resolves once it is up. Handoff relaunches through it. */
  launch: (chosen: Chosen, argv: string[]) => Promise<Subprocess>;
}

/**
 * One spawn of the session's child. Resolves with the running child and makes
 * it `live.child`; the caller waits on the child's own `exited`. Nothing in
 * spawnOn rejects after the child is up, so a rejection here is a failed
 * spawn and the caller's to handle.
 */
function launchLive(live: LiveSession, chosen: Chosen, argv: string[]): Promise<Subprocess> {
  return new Promise<Subprocess>((resolve, reject) => {
    spawnOn(live.ctx, chosen, argv, {
      limitDir: live.plan.limitDir,
      stdin: live.pump ? "pipe" : "inherit",
      onSpawn: (child) => {
        live.child = child;
        live.chosen = chosen;
        resolve(child);
      },
    }).catch(reject);
  });
}

/** Override, then Pin, then Selection. */
async function chooseForSessionStart(ctx: LaunchContext, model: string | null): Promise<Chosen> {
  return (await chooseNamed(ctx, { model })) ?? chooseBySelection(ctx, model);
}

/**
 * Whether the Active account gets its one request before Selection reads it.
 * Older than ten minutes: always. Fresh: never. Stale, under the threshold,
 * with every Reset ahead: never. A live Limit that no Reading has looked at
 * since: once, so the Limit can clear early (ADR 0007). Otherwise: once.
 */
export function activeNeedsPoll(record: AccountRecord, model: string | null, threshold: number, now: number): boolean {
  const usage = record.usage;
  const fetched = usage.fetchedAt ? Date.parse(usage.fetchedAt) : Number.NaN;
  if (Number.isNaN(fetched) || now - fetched >= ACTIVE_STALE_MS) return true;
  const limit = liveLimit(record, model, now);
  if (limit && !(fetched > Date.parse(limit.reportedAt))) return true;
  if (isFresh(usage, now)) return false;
  const utilization = maxUtilization(applicableWindows(usage.lastGood, model, now));
  if (utilization !== null && utilization < threshold && readingStands(usage, model, now)) return false;
  return true;
}

/**
 * Selection over every Record. The Active account gets at most one request;
 * when Selection says leave, the candidates get theirs, then Selection runs
 * again over what came back. Nothing is polled once claude is running.
 */
async function chooseBySelection(ctx: LaunchContext, model: string | null): Promise<Chosen> {
  let records = listRecords();
  if (records.length === 0) {
    throw new ExitError(EXIT.REFUSED, "no Active account. Run `mclaude account add` to log in to one");
  }
  const threshold = ctx.settings.switchThreshold;
  const activeId = readActiveId();
  let now = Date.now();
  const poll = { timeoutMs: LAUNCH_TIMEOUT_MS, claudePath: ctx.claudePath, now };

  const active = records.find((r) => r.id === activeId);
  if (active && !active.disabled && activeNeedsPoll(active, model, threshold, now)) {
    await pollAccount(active, poll);
    records = listRecords();
  }

  let chosen = select({ records, activeId, model, threshold, now });
  if (chosen.kind !== "stay") {
    const candidates = refreshOrder(records, activeId, model, now);
    if (candidates.length > 0) {
      await pollMany(candidates, { ...poll, concurrency: CANDIDATE_CONCURRENCY });
      records = listRecords();
      // The polls took up to the request budget; a Reset may have passed meanwhile.
      now = Date.now();
      chosen = select({ records, activeId, model, threshold, now });
    }
  }
  return actOnSelection(ctx, chosen, records, model, now);
}

function actOnSelection(
  ctx: LaunchContext,
  chosen: Selection,
  records: AccountRecord[],
  model: string | null,
  now: number,
): Chosen {
  switch (chosen.kind) {
    case "stay":
    case "move":
      return { record: chosen.record, dir: accountDir(chosen.id), makeActive: true, source: "selection" };
    case "none":
      throw new ExitError(EXIT.REFUSED, "every Account is Disabled. Run `mclaude account enable <account>` or pin one");
    case "exhausted":
      return chooseFallback(ctx, records, model, now);
  }
}

/** Exhausted (ADR 0003): launch on the Fallback Account with one stderr line, or exit 75 when told to fail. */
function chooseFallback(ctx: LaunchContext, records: AccountRecord[], model: string | null, now: number): Chosen {
  if (ctx.settings.onExhausted === "fail") {
    const wall = earliestWall(records, model, now);
    throw new ExitError(
      EXIT.EXHAUSTED,
      wall ? exhaustedFailLine(wall.record.alias, wall.window, wall.resetsAt) : exhaustedFailLine(null, null, null),
    );
  }
  const fb = fallback(records, model, now);
  if (!fb)
    throw new ExitError(EXIT.REFUSED, "every Account is Disabled. Run `mclaude account enable <account>` or pin one");
  const tail =
    fb.tier === "unknown"
      ? "its usage is unknown."
      : fb.tier === "credits"
        ? "using extra usage credits."
        : resetsTail(fb.window, fb.resetsAt);
  warn(`every account is at its limit. Launching on ${fb.record.alias}; ${tail}`);
  return { record: fb.record, dir: accountDir(fb.record.id), makeActive: false, source: "fallback" };
}

/** The exit-75 line: the Account whose wall lifts first, its Window and the local Reset time. */
function exhaustedFailLine(alias: string | null, window: string | null, resetsAt: string | null): string {
  const when =
    alias && resetsAt
      ? `earliest reset is ${alias} ${window ?? "usage"} at ${localTime(resetsAt)}`
      : "no reset time is known";
  return `every account is at its limit; ${when}. See \`mclaude account list\``;
}

/** `five_hour resets 3/4/2026, 3:45:00 PM.` for the stderr lines that name a wall. */
function resetsTail(window: string | null, resetsAt: string | null): string {
  return `${window ?? "usage"} resets ${resetsAt ? localTime(resetsAt) : "at an unknown time"}.`;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** `claude --version` answers in well under a second; this only guards against a wedged binary. */
export const VERSION_PROBE_TIMEOUT_MS = 10_000;

/** A Session start on a claude below the Version floor is refused with exit 69. Unparseable output proceeds. */
export async function checkVersionFloor(ctx: LaunchContext): Promise<void> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const r = await runCaptured(ctx.claudePath, ["--version"], env, { timeoutMs: VERSION_PROBE_TIMEOUT_MS });
  const found = parseVersion(r.stdout);
  if (!found) return;
  if (compareVersions(found, parseVersion(VERSION_FLOOR)!) < 0) {
    throw new ExitError(
      EXIT.NO_CLAUDE,
      `claude ${found.join(".")} is below the version floor ${VERSION_FLOOR}; Handoff would lose the conversation. Update Claude Code`,
    );
  }
}

/**
 * Spawns claude on the chosen Account with inherited stdio (a piped stdin on
 * the stream-json path, ADR 0006) and resolves with the exited child, so the
 * caller can clean up before mirroring its exit. The Run marker lives for the
 * spawn and goes with it.
 */
export async function spawnOn(
  ctx: LaunchContext,
  chosen: Chosen,
  argv: string[],
  opts: {
    limitDir: string | undefined;
    cwd?: string;
    stdin?: "inherit" | "pipe";
    onSpawn?: (child: Subprocess) => void;
  },
): Promise<Subprocess> {
  if (!existsSync(chosen.dir)) {
    throw new ExitError(EXIT.REFUSED, `Account dir for ${chosen.record.alias} (${chosen.record.id}) is missing`);
  }
  sweepSignalDirs(Date.now());
  runSymlinkFarm(chosen.dir);
  await syncPreferences(chosen.dir);
  if (chosen.makeActive) writeActiveId(chosen.record.id);
  const env = buildChildEnv({ accountDir: chosen.dir, accountId: chosen.record.id, limitDir: opts.limitDir });
  // The forwarder goes on before the marker and the spawn, so a signal landing
  // in between is held for the child instead of killing mclaude with the
  // marker still on disk.
  let child: Subprocess | undefined;
  const stopForwarding = forwardSignals(() => child);
  const releaseMarker = writeRunMarker(chosen.dir);
  try {
    child = spawnClaude(ctx.claudePath, {
      argv,
      env,
      cwd: opts.cwd,
      stdin: opts.stdin ?? "inherit",
    });
    opts.onSpawn?.(child);
    await child.exited;
  } finally {
    stopForwarding();
    releaseMarker();
  }
  return child;
}
