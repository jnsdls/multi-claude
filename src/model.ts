// The Requested model: what a Session start will run under, as far as mclaude
// can tell. Read from the same places Claude Code reads it, in Claude Code's
// order of precedence. Pure apart from reading the settings files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scan } from "./argv.ts";
import { sharedHome } from "./paths.ts";

/** The `model` key of one settings file, or null when the file is missing, unreadable, or has no string there. */
export function modelFromSettingsFile(path: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>).model : undefined;
    return typeof m === "string" && m.trim() !== "" ? m.trim() : null;
  } catch {
    return null;
  }
}

/** `opusplan` runs Opus for planning and is budgeted as opus. Everything else is taken as given. */
export function normalizeModel(model: string): string {
  return model.toLowerCase() === "opusplan" ? "opus" : model;
}

/**
 * `--model`, then `ANTHROPIC_MODEL`, then `model` in `<cwd>/.claude/settings.local.json`,
 * then `<cwd>/.claude/settings.json`, then the Shared home `settings.json`.
 * `--fallback-model` is ignored: it names what Claude Code falls back to, not what
 * it runs. Null when none of them says, which makes every scoped Window apply.
 */
export function resolveRequestedModel(scan: Pick<Scan, "model">, env: NodeJS.ProcessEnv, cwd: string): string | null {
  if (scan.model) return normalizeModel(scan.model);
  if (env.ANTHROPIC_MODEL) return normalizeModel(env.ANTHROPIC_MODEL);
  const files = [
    join(cwd, ".claude", "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(sharedHome(), "settings.json"),
  ];
  for (const f of files) {
    const m = modelFromSettingsFile(f);
    if (m) return normalizeModel(m);
  }
  return null;
}
