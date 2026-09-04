// The argv contract: pure functions, no I/O. Argv position zero decides the mode;
// own flags are stripped before a bare `--`; a scan-only pass reads claude's flags
// without consuming them; a Session start is classified from the scan.
import {
  CLAUDE_COMMANDS,
  CLAUDE_FLAG_ARITY,
  SCAN_BOOL_FLAGS,
  SCAN_OPTIONAL_VALUE_FLAGS,
  SCAN_VALUE_FLAGS,
  type FlagArity,
} from "./tables.ts";

export type Mode =
  | { kind: "account"; args: string[] }
  | { kind: "version" }
  | { kind: "hook" }
  | { kind: "passthrough"; argv: string[]; forced: boolean };

export const RESERVED_WORDS = ["account", "version", "hook"] as const;

/** Argv position zero decides the mode. A bare `--` forces Passthrough of the rest. */
export function classifyMode(argv: readonly string[]): Mode {
  const first = argv[0];
  if (first === "account") return { kind: "account", args: argv.slice(1) };
  if (first === "version") return { kind: "version" };
  if (first === "hook") return { kind: "hook" };
  if (first === "--") return { kind: "passthrough", argv: argv.slice(1), forced: true };
  return { kind: "passthrough", argv: [...argv], forced: false };
}

export interface OwnFlags {
  onExhausted?: string;
  switchThreshold?: string;
  account?: string;
}

const OWN_FLAGS: Record<string, keyof OwnFlags> = {
  "--on-exhausted": "onExhausted",
  "--switch-threshold": "switchThreshold",
  "--account": "account",
};

export interface StripResult {
  own: OwnFlags;
  forwarded: string[];
  /** Usage errors, such as an own flag with no value. */
  errors: string[];
}

/**
 * Strips mclaude's own flags with their values wherever they appear before a bare
 * `--`, in both `--flag value` and `--flag=value` forms. Everything else is kept in
 * original order. `--` itself is never stripped or moved.
 */
export function stripOwnFlags(argv: readonly string[]): StripResult {
  const own: OwnFlags = {};
  const forwarded: string[] = [];
  const errors: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok === "--") {
      forwarded.push(...argv.slice(i));
      break;
    }
    const eq = tok.indexOf("=");
    const name = eq >= 0 ? tok.slice(0, eq) : tok;
    const key = OWN_FLAGS[name];
    if (key) {
      if (eq >= 0) {
        own[key] = tok.slice(eq + 1);
        i += 1;
      } else if (i + 1 < argv.length) {
        own[key] = argv[i + 1]!;
        i += 2;
      } else {
        errors.push(`${name} needs a value`);
        i += 1;
      }
      continue;
    }
    forwarded.push(tok);
    i += 1;
  }
  return { own, forwarded, errors };
}

export interface Scan {
  model?: string;
  fallbackModel?: string;
  print: boolean;
  outputFormat?: string;
  inputFormat?: string;
  /** A session id, or `true` when `--resume` was given with no value (the picker). */
  resume?: string | true;
  continue: boolean;
  sessionId?: string;
  forkSession: boolean;
  bg: boolean;
  settings?: string;
  bare: boolean;
  safeMode: boolean;
  version: boolean;
  help: boolean;
  /** Tokens that did not look like flags, plus everything after a bare `--`. */
  positionals: string[];
}

/**
 * Reads the scan-only flags without consuming anything. Steps over every other
 * token; no reparse of claude's grammar, no short-flag clustering. Tokens after a
 * bare `--` are positionals.
 */
export function scanArgv(argv: readonly string[]): Scan {
  const scan: Scan = {
    print: false,
    continue: false,
    forkSession: false,
    bg: false,
    bare: false,
    safeMode: false,
    version: false,
    help: false,
    positionals: [],
  };
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok === "--") {
      scan.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!tok.startsWith("-") || tok === "-") {
      scan.positionals.push(tok);
      i += 1;
      continue;
    }
    const eq = tok.startsWith("--") ? tok.indexOf("=") : -1;
    const name = eq >= 0 ? tok.slice(0, eq) : tok;
    const inlineValue = eq >= 0 ? tok.slice(eq + 1) : undefined;

    if (SCAN_VALUE_FLAGS.has(name)) {
      let value = inlineValue;
      if (value === undefined && i + 1 < argv.length) {
        value = argv[i + 1]!;
        i += 1;
      }
      setValueFlag(scan, name, value);
      i += 1;
      continue;
    }
    if (SCAN_OPTIONAL_VALUE_FLAGS.has(name)) {
      let value: string | true = inlineValue ?? true;
      if (value === true && i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
        value = argv[i + 1]!;
        i += 1;
      }
      scan.resume = value;
      i += 1;
      continue;
    }
    if (SCAN_BOOL_FLAGS.has(name)) {
      setBoolFlag(scan, name);
      i += 1;
      continue;
    }
    if (name === "--version" || name === "-v") scan.version = true;
    else if (name === "--help" || name === "-h") scan.help = true;
    i += 1;
  }
  return scan;
}

function setValueFlag(scan: Scan, name: string, value: string | undefined): void {
  if (value === undefined) return;
  switch (name) {
    case "--model":
      scan.model = value;
      break;
    case "--fallback-model":
      scan.fallbackModel = value;
      break;
    case "--output-format":
      scan.outputFormat = value;
      break;
    case "--input-format":
      scan.inputFormat = value;
      break;
    case "--session-id":
      scan.sessionId = value;
      break;
    case "--settings":
      scan.settings = value;
      break;
  }
}

function setBoolFlag(scan: Scan, name: string): void {
  switch (name) {
    case "-p":
    case "--print":
      scan.print = true;
      break;
    case "-c":
    case "--continue":
      scan.continue = true;
      break;
    case "--fork-session":
      scan.forkSession = true;
      break;
    case "--bg":
    case "--background":
      scan.bg = true;
      break;
    case "--bare":
      scan.bare = true;
      break;
    case "--safe-mode":
      scan.safeMode = true;
      break;
  }
}

export type Classification =
  /** claude's version on stdout, mclaude's on stderr. */
  | "version"
  /** Forwarded to claude with the mclaude footer on stderr. */
  | "help"
  /** `auth login` or `auth logout`: refused with a pointer at `account`. */
  | "auth-refused"
  /** Opens or resumes a conversation: runs Selection and the usage poll. */
  | "session-start"
  /** Any other claude invocation: runs on the Active account with no poll. */
  | "passthrough";

/**
 * Session starts are the TUI default, a positional prompt, `-p`, `--resume`,
 * `--continue` and `--bg`. A first positional that is one of claude's own
 * commands is a plain Passthrough.
 */
export function classify(scan: Scan): Classification {
  if (scan.help) return "help";
  if (scan.version) return "version";
  const first = scan.positionals[0];
  if (first === "auth") {
    const sub = scan.positionals[1];
    if (sub === "login" || sub === "logout") return "auth-refused";
    return "passthrough";
  }
  if (first !== undefined && CLAUDE_COMMANDS.has(first)) return "passthrough";
  return "session-start";
}

/** True when the scan shows `--input-format stream-json`, the path where mclaude pipes stdin. */
export function isStreamJsonInput(scan: Scan): boolean {
  return scan.inputFormat === "stream-json";
}

/**
 * Removes every occurrence of a value flag (both forms) before a bare `--`.
 * Used to replace a user's `--settings` with the merged per-session file.
 */
export function removeValueFlag(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok === "--") {
      out.push(...argv.slice(i));
      break;
    }
    if (tok === flag) {
      i += 2;
      continue;
    }
    if (tok.startsWith(`${flag}=`)) {
      i += 1;
      continue;
    }
    out.push(tok);
    i += 1;
  }
  return out;
}

/** What a Handoff relaunch replaces: the session is named by `--resume` and the settings file by the plan. */
const RELAUNCH_DROPPED_FLAGS = new Set(["--session-id", "--settings", "--resume", "-r", "--continue", "-c"]);

/**
 * The argv a Handoff relaunch hands claude: the user's flags with their values,
 * minus anything that names a session or the settings file, minus every
 * positional (the prompt is already in the transcript), then `--resume <id>
 * --settings <path>` and the resend as the positional prompt (none on the
 * stream-json path, where stdin carries it).
 *
 * Values are told from positionals by the arity table: a `one` flag takes the
 * next token, a `variadic` flag every token up to the next one starting with
 * `-`, an `optional` flag the next token when it does not start with `-`. A
 * flag the table does not know is boolean. Everything after a bare `--` is
 * prompt text and goes.
 */
export function relaunchArgv(
  forwarded: readonly string[],
  sessionId: string,
  settingsPath: string,
  prompt: string | null,
): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < forwarded.length) {
    const tok = forwarded[i]!;
    if (tok === "--") break;
    const isFlag = tok.startsWith("-") && tok !== "-";
    if (!isFlag) {
      i += 1;
      continue;
    }
    const eq = tok.startsWith("--") ? tok.indexOf("=") : -1;
    const name = eq >= 0 ? tok.slice(0, eq) : tok;
    const arity: FlagArity = eq >= 0 ? "none" : (CLAUDE_FLAG_ARITY[name] ?? "none");
    const values: string[] = [];
    if (arity === "one" && i + 1 < forwarded.length) values.push(forwarded[i + 1]!);
    else if (arity === "optional" && i + 1 < forwarded.length && !forwarded[i + 1]!.startsWith("-"))
      values.push(forwarded[i + 1]!);
    else if (arity === "variadic") {
      for (let j = i + 1; j < forwarded.length && !forwarded[j]!.startsWith("-"); j++) values.push(forwarded[j]!);
    }
    if (!RELAUNCH_DROPPED_FLAGS.has(name)) out.push(tok, ...values);
    i += 1 + values.length;
  }
  out.push("--resume", sessionId, "--settings", settingsPath);
  if (prompt !== null) {
    if (prompt.startsWith("-")) out.push("--");
    out.push(prompt);
  }
  return out;
}
