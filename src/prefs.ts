// Preferences flow one way, from the Shared home .claude.json into each Account
// copy (ADR 0010). The merge is pure; the sync around it takes Claude Code's own
// lock dir, skips when a launch is running in the dir, and never blocks a launch.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isObject } from "./json.ts";
import { sharedClaudeJson } from "./paths.ts";
import { writeFileAtomic } from "./record.ts";
import { liveRunMarkers } from "./runmarker.ts";
import { APPROVAL_BOOLEAN_KEYS, MCPJSON_LIST_KEYS, PREFERENCE_KEYS_PROJECT, PREFERENCE_KEYS_TOP } from "./tables.ts";

export type ClaudeJson = Record<string, unknown>;
type Project = Record<string, unknown>;

const APPROVAL_BOOLEANS = new Set<string>(APPROVAL_BOOLEAN_KEYS);
const MCPJSON_LISTS = new Set<string>(MCPJSON_LIST_KEYS);
const LOCK_WAIT_MS = 2000;
const LOCK_STEP_MS = 50;

function projectsOf(json: ClaudeJson): Record<string, Project> {
  const p = json.projects;
  if (!isObject(p)) return {};
  const out: Record<string, Project> = {};
  for (const [path, entry] of Object.entries(p)) if (isObject(entry)) out[path] = entry;
  return out;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/**
 * The union of the two mcpjson lists with the source side winning a conflict: a
 * server the source enables is dropped from the target's disabled list and the
 * other way round.
 */
function mergeMcpjsonLists(source: Project, target: Project): Project {
  const out: Project = {};
  const sourceEnabled = stringList(source.enabledMcpjsonServers);
  const sourceDisabled = stringList(source.disabledMcpjsonServers);
  const pairs: [string, string[], string[]][] = [
    ["enabledMcpjsonServers", sourceEnabled, sourceDisabled],
    ["disabledMcpjsonServers", sourceDisabled, sourceEnabled],
  ];
  for (const [key, ours, theirsOpposite] of pairs) {
    if (!(key in source) && !(key in target)) continue;
    const merged = [...ours];
    for (const s of stringList(target[key])) if (!merged.includes(s) && !theirsOpposite.includes(s)) merged.push(s);
    out[key] = merged;
  }
  return out;
}

/** One project's allowlisted keys from `source` merged onto `target`. Pure. */
function mergeProject(source: Project, target: Project, keys: readonly string[]): Project {
  const out: Project = { ...target };
  const lists = mergeMcpjsonLists(source, target);
  for (const key of keys) {
    if (APPROVAL_BOOLEANS.has(key)) {
      if (key in source || key in target) out[key] = source[key] === true || target[key] === true;
    } else if (MCPJSON_LISTS.has(key)) {
      if (key in lists) out[key] = lists[key];
    } else if (key in source) {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * Shared wins per allowlisted key, mcpServers maps replaced whole. The three
 * approval booleans OR, the two mcpjson lists union with Shared winning a
 * conflict. Project entries only in the Account copy are kept. Keys outside the
 * allowlist are untouched. Pure; returns a new object.
 */
export function mergePreferences(shared: ClaudeJson, account: ClaudeJson): ClaudeJson {
  const out: ClaudeJson = { ...account };
  for (const key of PREFERENCE_KEYS_TOP) if (key in shared) out[key] = shared[key];
  const sharedProjects = projectsOf(shared);
  if (Object.keys(sharedProjects).length > 0 || isObject(account.projects)) {
    const projects: Record<string, unknown> = isObject(account.projects) ? { ...account.projects } : {};
    for (const [path, entry] of Object.entries(sharedProjects)) {
      const current = isObject(projects[path]) ? (projects[path] as Project) : {};
      projects[path] = mergeProject(entry, current, PREFERENCE_KEYS_PROJECT);
    }
    out.projects = projects;
  }
  return out;
}

/** The allowlist from the Shared copy plus hasCompletedOnboarding: true, nothing else. */
export function seedClaudeJson(shared: ClaudeJson): ClaudeJson {
  const seed = mergePreferences(shared, {});
  const out: ClaudeJson = {};
  for (const key of PREFERENCE_KEYS_TOP) if (key in seed) out[key] = seed[key];
  const projects: Record<string, Project> = {};
  for (const [path, entry] of Object.entries(projectsOf(seed))) {
    const kept: Project = {};
    for (const key of PREFERENCE_KEYS_PROJECT) if (key in entry) kept[key] = entry[key];
    projects[path] = kept;
  }
  if (Object.keys(projects).length > 0) out.projects = projects;
  out.hasCompletedOnboarding = true;
  return out;
}

export function readClaudeJson(path: string): ClaudeJson | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return isObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function accountClaudeJson(accountDir: string): string {
  return join(accountDir, ".claude.json");
}

/**
 * Claude Code's proper-lockfile style lock: a `.claude.json.lock` directory whose
 * mkdir succeeding means you hold it. Returns a release function, or null when
 * the lock was not free within two seconds.
 */
async function acquireLock(accountDir: string): Promise<(() => void) | null> {
  const lock = `${accountClaudeJson(accountDir)}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      return () => rmSync(lock, { recursive: true, force: true });
    } catch {
      if (Date.now() >= deadline) return null;
      await Bun.sleep(LOCK_STEP_MS);
    }
  }
}

/** Reads, merges and writes the Account copy under the lock. Writes nothing when nothing changed. */
async function updateAccountCopy(accountDir: string, change: (account: ClaudeJson) => ClaudeJson): Promise<void> {
  const path = accountClaudeJson(accountDir);
  const release = await acquireLock(accountDir);
  if (!release) return;
  try {
    const before = readClaudeJson(path);
    if (!before) return;
    const after = change(before);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    writeFileAtomic(path, `${JSON.stringify(after, null, 2)}\n`);
  } finally {
    release();
  }
}

/**
 * Copies the Preferences allowlist from the Shared .claude.json into the Account
 * copy. Silent on every skip: no Shared file, a live Run marker in the dir, a held
 * lock, an unreadable copy. Never throws, so a launch is never blocked by it.
 */
export async function syncPreferences(accountDir: string): Promise<void> {
  try {
    const shared = readClaudeJson(sharedClaudeJson());
    if (!shared) return;
    if (!existsSync(accountClaudeJson(accountDir))) return;
    if (liveRunMarkers(accountDir).length > 0) return;
    await updateAccountCopy(accountDir, (account) => mergePreferences(shared, account));
  } catch {
    // A sync that fails leaves the last copy in place; the launch goes ahead.
  }
}

const APPROVAL_KEYS: readonly string[] = [...APPROVAL_BOOLEAN_KEYS, ...MCPJSON_LIST_KEYS];

/**
 * One project's approval keys from one Account copy merged into another, same
 * rule as the sync with the source side winning. For Handoff, so the resumed
 * session opens without a trust dialog. No Shared write.
 */
export async function mergeProjectApprovals(
  sourceAccountDir: string,
  targetAccountDir: string,
  projectPath: string,
): Promise<void> {
  try {
    const source = readClaudeJson(accountClaudeJson(sourceAccountDir));
    const entry = source ? projectsOf(source)[projectPath] : undefined;
    if (!entry) return;
    await updateAccountCopy(targetAccountDir, (target) => {
      const projects = isObject(target.projects) ? { ...target.projects } : {};
      const current = isObject(projects[projectPath]) ? (projects[projectPath] as Project) : {};
      projects[projectPath] = mergeProject(entry, current, APPROVAL_KEYS);
      return { ...target, projects };
    });
  } catch {
    // Same as the sync: never block the relaunch.
  }
}
