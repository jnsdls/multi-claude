// The Limit hook's launch side (ADR 0008): the per-session settings file that
// carries mclaude's two hook entries, the argv a Session start gets, the Signal
// dir the hook writes into, and the watcher that reads it. `mclaude hook`, the
// other side, lives in hook.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { removeValueFlag, type Scan } from "./argv.ts";
import type { Signal } from "./hook.ts";
import { limitsDir, signalDir } from "./paths.ts";
import { writeFileAtomic } from "./record.ts";

/** A Signal dir whose newest file is older than this is swept at Session start. */
export const SIGNAL_DIR_MAX_AGE_MS = 7 * 86_400_000;
/** The readdir fallback under fs.watch. */
export const SIGNAL_POLL_MS = 250;

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command the hook entries run: the running mclaude, by absolute path, plus
 * the Reserved word `hook`. A compiled binary is one path; under bun it is bun
 * plus the running script. Never through PATH, because the t3/code Binary path
 * runs mclaude without one.
 */
export function hookCommand(): string {
  const parts = Bun.isStandaloneExecutable ? [process.execPath] : [process.execPath, Bun.main];
  return `${parts.map(shellQuote).join(" ")} hook`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * The user's settings with mclaude's two entries appended to `hooks`: a
 * `StopFailure` entry matched on `rate_limit` and an unmatched `SessionStart`
 * entry. User entries stay ahead. Never `PostToolUseFailure`: a failing tool is
 * not a Limit (cux issue 39).
 */
export function hookSettings(userSettings: object | null, command: string = hookCommand()): Record<string, unknown> {
  const base: Record<string, unknown> = userSettings ? structuredClone(userSettings) as Record<string, unknown> : {};
  const hooks: Record<string, unknown> = isObject(base.hooks) ? base.hooks : {};
  const entry = { type: "command", command };
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  hooks.StopFailure = [...list(hooks.StopFailure), { matcher: "rate_limit", hooks: [entry] }];
  hooks.SessionStart = [...list(hooks.SessionStart), { hooks: [entry] }];
  base.hooks = hooks;
  return base;
}

/**
 * A `--settings` value the way claude reads it: inline JSON when it starts with
 * `{`, otherwise a path relative to the cwd. Null when unreadable or not a JSON
 * object.
 */
export function resolveUserSettings(value: string, cwd: string): Record<string, unknown> | null {
  try {
    const text = value.trim().startsWith("{") ? value : readFileSync(resolve(cwd, value), "utf8");
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The session id a launch runs under: the user's `--session-id` or `--resume <id>`,
 * else a fresh uuid. `--resume` with no value and `--continue` leave the id to
 * claude; the uuid then only names the Signal dir until `SessionStart` reports
 * the real one. A value that cannot name a directory gets a uuid too.
 */
export function sessionIdFor(scan: Scan): string {
  const given = scan.sessionId ?? (typeof scan.resume === "string" ? scan.resume : undefined);
  if (given && /^[A-Za-z0-9._-]+$/.test(given) && given !== "." && given !== "..") return given;
  return crypto.randomUUID();
}

export interface SessionPlan {
  sessionId: string;
  limitDir: string;
  settingsPath: string;
  /** The user's `--settings` could not be read; it is forwarded untouched and the hook is off. */
  userSettingsUnparseable: boolean;
}

/**
 * Sweeps stale Signal dirs, creates `limits/<session-id>/` 0700 and writes the
 * merged settings.json there (0600, rewritten every launch so the hook command
 * never goes stale after an upgrade or a move).
 */
export function prepareSession(scan: Pick<Scan, "settings">, sessionId: string, cwd: string = process.cwd()): SessionPlan {
  sweepSignalDirs(Date.now());
  const user = scan.settings === undefined ? null : resolveUserSettings(scan.settings, cwd);
  const limitDir = signalDir(sessionId);
  mkdirSync(limitDir, { recursive: true, mode: 0o700 });
  const settingsPath = join(limitDir, "settings.json");
  writeFileAtomic(settingsPath, `${JSON.stringify(hookSettings(user), null, 2)}\n`);
  return { sessionId, limitDir, settingsPath, userSettingsUnparseable: scan.settings !== undefined && user === null };
}

/** Removes every `limits/` dir whose newest file is older than 7 days. A dir with a recent file is never touched. */
export function sweepSignalDirs(now: number): void {
  const root = limitsDir();
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    let newest: number;
    try {
      const st = statSync(dir);
      if (!st.isDirectory()) continue;
      newest = st.mtimeMs;
      for (const f of readdirSync(dir)) newest = Math.max(newest, statSync(join(dir, f)).mtimeMs);
    } catch {
      continue;
    }
    if (now - newest > SIGNAL_DIR_MAX_AGE_MS) rmSync(dir, { recursive: true, force: true });
  }
}

/** The Signal dir dies with the launch. */
export function cleanupSignalDir(limitDir: string): void {
  rmSync(limitDir, { recursive: true, force: true });
}

/** Inserts tokens before a bare `--` so claude reads them as flags, else appends them. */
function appendFlags(argv: readonly string[], flags: string[]): string[] {
  const dash = argv.indexOf("--");
  if (dash < 0) return [...argv, ...flags];
  return [...argv.slice(0, dash), ...flags, ...argv.slice(dash)];
}

/**
 * The argv a Session start hands claude: the user's tokens in order, then
 * `--session-id` when the user named no session, then `--settings` pointing at
 * the per-session file in place of the user's own. An unparseable user value is
 * left where it was, nothing is added for settings, and the warning says so.
 */
export function injectSessionArgv(
  forwarded: readonly string[],
  scan: Pick<Scan, "sessionId" | "resume" | "continue" | "settings">,
  sessionId: string,
  settingsPath: string,
  userSettingsUnparseable: boolean,
): { argv: string[]; warning: string | null } {
  const userNamedSession = scan.sessionId !== undefined || scan.resume !== undefined || scan.continue;
  const flags: string[] = userNamedSession ? [] : ["--session-id", sessionId];
  if (userSettingsUnparseable) {
    return {
      argv: appendFlags(forwarded, flags),
      warning: `--settings ${scan.settings} could not be read as a file or JSON, so Limit detection is off for this launch`,
    };
  }
  const base = scan.settings === undefined ? forwarded : removeValueFlag(forwarded, "--settings");
  return { argv: appendFlags(base, [...flags, "--settings", settingsPath]), warning: null };
}

export interface SignalHandlers {
  /** Every `SessionStart` Signal; the payload's `session_id` is the one the session now runs under. */
  onSessionStart(signal: Signal): void | Promise<void>;
  /** Every `StopFailure` Signal whose payload says `error: "rate_limit"`, with or without `agent_id`. */
  onLimit(signal: Signal): void | Promise<void>;
}

export interface SignalWatcher {
  /**
   * Reads the dir one last time, closes the watcher and resolves once every
   * handler has returned. The last read matters: a hook that fires just before
   * the child exits has its Signal on disk before the next poll tick.
   */
  stop(): Promise<void>;
}

function parseSignal(text: string): Signal | null {
  try {
    const v = JSON.parse(text);
    if (!isObject(v) || !isObject(v.payload) || typeof v.receivedAt !== "string") return null;
    return { payload: v.payload, accountId: typeof v.accountId === "string" ? v.accountId : null, receivedAt: v.receivedAt };
  } catch {
    return null;
  }
}

export function isLimitSignal(signal: Signal): boolean {
  return signal.payload.hook_event_name === "StopFailure" && signal.payload.error === "rate_limit";
}

/**
 * Watches the Signal dir with fs.watch plus a readdir poll, handles each Signal
 * once in name order, and serialises the handlers. A file that does not parse
 * yet is left for the next tick, since the hook writes by rename and a torn read
 * means the rename has not landed. settings.json and dotfiles are ignored.
 */
export function watchSignals(limitDir: string, handlers: SignalHandlers): SignalWatcher {
  const seen = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;

  const handle = (signal: Signal) => {
    const event = signal.payload.hook_event_name;
    if (event === "SessionStart") return handlers.onSessionStart(signal);
    if (isLimitSignal(signal)) return handlers.onLimit(signal);
    return undefined;
  };

  const scan = () => {
    if (stopped) return;
    let names: string[];
    try {
      names = readdirSync(limitDir).filter((n) => n.endsWith(".json") && !n.startsWith(".") && n !== "settings.json" && !seen.has(n)).sort();
    } catch {
      return;
    }
    for (const name of names) {
      let signal: Signal | null;
      try {
        signal = parseSignal(readFileSync(join(limitDir, name), "utf8"));
      } catch {
        continue;
      }
      if (!signal) continue;
      seen.add(name);
      chain = chain.then(() => handle(signal!)).catch(() => undefined);
    }
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(limitDir, () => scan());
    watcher.on("error", () => undefined);
    watcher.unref();
  } catch {
    watcher = null;
  }
  const timer = setInterval(scan, SIGNAL_POLL_MS);
  timer.unref();
  scan();

  return {
    async stop() {
      scan();
      stopped = true;
      clearInterval(timer);
      watcher?.close();
      await chain;
    },
  };
}
