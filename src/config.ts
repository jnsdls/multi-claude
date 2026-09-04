// config.json: hand-edited JSONC, never created by mclaude (ADR 0005). Only
// invocations that use a key open the file. Precedence: flag, env, file, default.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, ExitError } from "./exit.ts";
import { warn } from "./log.ts";
import { configPath, homeDir } from "./paths.ts";

export type OnExhausted = "launch" | "fail";

export interface ConfigFile {
  onExhausted?: OnExhausted;
  switchThreshold?: number;
  claudePath?: string;
}

export const DEFAULT_SWITCH_THRESHOLD = 90;
export const DEFAULT_ON_EXHAUSTED: OnExhausted = "launch";

const KNOWN_KEYS = new Set(["onExhausted", "switchThreshold", "claudePath", "version"]);

function bad(key: string, rule: string): ExitError {
  return new ExitError(EXIT.CONFIG, `config.json: ${key} ${rule}`);
}

/** Parses and validates the config file text. Pure apart from the warning line. */
export function parseConfig(text: string, onWarn: (line: string) => void = warn): ConfigFile {
  let raw: unknown;
  try {
    raw = Bun.JSONC.parse(text);
  } catch (e) {
    throw new ExitError(EXIT.CONFIG, `config.json: not valid JSONC (${(e as Error).message})`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExitError(EXIT.CONFIG, "config.json: the top level must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const out: ConfigFile = {};
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) onWarn(`config.json: unknown key "${key}" ignored`);
  }
  if ("version" in obj && obj.version !== 1) throw bad("version", "must be 1");
  if ("onExhausted" in obj) {
    const v = obj.onExhausted;
    if (v !== "launch" && v !== "fail") throw bad("onExhausted", 'must be "launch" or "fail"');
    out.onExhausted = v;
  }
  if ("switchThreshold" in obj) {
    const v = obj.switchThreshold;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
      throw bad("switchThreshold", "must be a number from 0 to 100");
    }
    out.switchThreshold = v;
  }
  if ("claudePath" in obj) {
    const v = obj.claudePath;
    if (typeof v !== "string" || !(v.startsWith("/") || v === "~" || v.startsWith("~/"))) {
      throw bad("claudePath", "must be an absolute or ~-prefixed path");
    }
    out.claudePath = v;
  }
  return out;
}

/** Loads config.json. A missing file means every default. Throws ExitError(78) when invalid. */
export function loadConfigFile(): ConfigFile {
  const path = configPath();
  if (!existsSync(path)) return {};
  return parseConfig(readFileSync(path, "utf8"));
}

export function expandTilde(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return join(homeDir(), p.slice(2));
  return p;
}

export interface Settings {
  onExhausted: OnExhausted;
  switchThreshold: number;
  /** The configured claude path from env or file, if any. Resolution happens in claude-path.ts. */
  claudePath?: { value: string; source: "env" | "config" };
}

/**
 * Merges flag, env, file and default for every key. Flag and env values are
 * validated the same way as the file; a bad one is a usage error (64).
 */
export function resolveSettings(
  flags: { onExhausted?: string; switchThreshold?: string },
  file: ConfigFile,
  env: NodeJS.ProcessEnv = process.env,
): Settings {
  const onExhaustedRaw = flags.onExhausted ?? env.MCLAUDE_ON_EXHAUSTED;
  let onExhausted: OnExhausted = file.onExhausted ?? DEFAULT_ON_EXHAUSTED;
  if (onExhaustedRaw !== undefined) {
    if (onExhaustedRaw !== "launch" && onExhaustedRaw !== "fail") {
      throw new ExitError(EXIT.USAGE, `--on-exhausted must be "launch" or "fail", got "${onExhaustedRaw}"`);
    }
    onExhausted = onExhaustedRaw;
  }
  const thresholdRaw = flags.switchThreshold ?? env.MCLAUDE_SWITCH_THRESHOLD;
  let switchThreshold = file.switchThreshold ?? DEFAULT_SWITCH_THRESHOLD;
  if (thresholdRaw !== undefined) {
    const n = Number(thresholdRaw);
    if (thresholdRaw.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
      throw new ExitError(EXIT.USAGE, `--switch-threshold must be a number from 0 to 100, got "${thresholdRaw}"`);
    }
    switchThreshold = n;
  }
  let claudePath: Settings["claudePath"];
  if (env.MCLAUDE_CLAUDE_PATH) claudePath = { value: env.MCLAUDE_CLAUDE_PATH, source: "env" };
  else if (file.claudePath) claudePath = { value: file.claudePath, source: "config" };
  return { onExhausted, switchThreshold, claudePath };
}
