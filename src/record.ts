// One Record per Account at state/<id>.json, written lock-free (ADR 0005).
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { accountDir, accountsDir, activePath, pinnedPath, recordPath, stateDir } from "./paths.ts";

/** One usage Window as the endpoint reports it. */
export interface Window {
  utilization: number | null;
  resets_at: string | null;
}

/** One entry of the endpoint's limits[] list. */
export interface LimitEntry {
  kind: string;
  group?: string;
  percent: number;
  resets_at: string | null;
  scope?: { model?: { id?: string | null; display_name: string } | null; surface?: unknown } | null;
}

/** The normalized usage body kept in the Record. */
export interface UsageBody {
  five_hour: Window | null;
  seven_day: Window | null;
  limits: LimitEntry[];
  extra_usage: { is_enabled: boolean; spend_limit_reached?: boolean | null };
}

export interface Usage {
  lastGood: UsageBody | null;
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  backoffUntil: string | null;
  last429At: string | null;
}

export interface Identity {
  accountUuid: string;
  organizationUuid: string;
  email: string;
  organizationName: string;
  subscriptionType: string | null;
  capturedAt: string;
}

export interface LastLimit {
  reportedAt: string;
  sessionId: string;
  /** The Window the Limit is in: `five_hour`, `seven_day`, or a scoped display name. Null until known. */
  window: string | null;
  /** The Window's Reset as the post-Limit Reading gave it. Null when that Reading never came; the name is then off the wall text. */
  resetsAt: string | null;
}

export interface AccountRecord {
  version: 1;
  id: string;
  alias: string;
  addedAt: string;
  disabled: boolean;
  identity: Identity;
  usage: Usage;
  lastLimit: LastLimit | null;
}

export const EMPTY_USAGE: Usage = {
  lastGood: null,
  fetchedAt: null,
  lastAttemptAt: null,
  backoffUntil: null,
  last429At: null,
};

/** Mints a short random lowercase id (8 chars, base32-ish alphabet). */
export function mintId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** A torn or unparseable file counts as absent. */
export function parseRecord(text: string): AccountRecord | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || obj.version !== 1 || typeof obj.id !== "string") return null;
    return obj as AccountRecord;
  } catch {
    return null;
  }
}

export function readRecord(id: string): AccountRecord | null {
  const p = recordPath(id);
  if (!existsSync(p)) return null;
  try {
    return parseRecord(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function newer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return Date.parse(a) > Date.parse(b);
}

/**
 * The write-merge rule: `next` wins, except that a Reading with an older
 * `fetchedAt` never replaces the current one and a Limit with an older
 * `reportedAt` never replaces the current one. Pure.
 */
export function mergeRecord(current: AccountRecord | null, next: AccountRecord): AccountRecord {
  if (!current) return next;
  const out: AccountRecord = { ...next };
  if (newer(current.usage?.fetchedAt, next.usage?.fetchedAt)) {
    out.usage = { ...next.usage, lastGood: current.usage.lastGood, fetchedAt: current.usage.fetchedAt };
  }
  if (current.lastLimit && newer(current.lastLimit.reportedAt, next.lastLimit?.reportedAt)) {
    out.lastLimit = current.lastLimit;
  }
  return out;
}

/** Temp file in the same dir, fsync, rename. Mode 0600. */
export function writeFileAtomic(path: string, data: string, mode = 0o600): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${crypto.randomUUID()}.tmp`);
  const fd = openSync(tmp, "w", mode);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Re-reads the current Record immediately before writing, applies the caller's
 * change on top of it, merges under the write rule, and writes atomically.
 * The callback sees the freshest Record and returns the whole next Record.
 */
export function updateRecord(
  id: string,
  change: (current: AccountRecord | null) => AccountRecord,
): AccountRecord {
  const current = readRecord(id);
  const next = mergeRecord(current, change(current));
  writeFileAtomic(recordPath(id), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Writes a brand-new Record (used by `account add`). */
export function writeRecord(record: AccountRecord): void {
  updateRecord(record.id, () => record);
}

export function deleteRecord(id: string): void {
  rmSync(recordPath(id), { force: true });
}

/** Every Record on disk, in no particular order. */
export function listRecords(): AccountRecord[] {
  const dir = stateDir();
  if (!existsSync(dir)) return [];
  const out: AccountRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const r = readRecord(f.slice(0, -".json".length));
    if (r) out.push(r);
  }
  return out;
}

/** Account dirs with no Record. */
export function listOrphans(): string[] {
  const dir = accountsDir();
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const id of readdirSync(dir)) {
    if (id.startsWith(".")) continue;
    try {
      if (!statSync(join(dir, id)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!readRecord(id)) out.push(id);
  }
  return out;
}

/** Exact id match first, then Alias. Null when nothing matches. */
export function resolveAccount(name: string, records: AccountRecord[] = listRecords()): AccountRecord | null {
  return records.find((r) => r.id === name) ?? records.find((r) => r.alias === name) ?? null;
}

function readPointer(path: string): string | null {
  try {
    const v = readFileSync(path, "utf8").trim();
    return v === "" ? null : v;
  } catch {
    return null;
  }
}

/** The Active account's id, or null when the pointer is absent, dangling or names an Orphan. */
export function readActiveId(): string | null {
  const id = readPointer(activePath());
  if (!id) return null;
  if (!readRecord(id) || !existsSync(accountDir(id))) return null;
  return id;
}

export function writeActiveId(id: string): void {
  writeFileAtomic(activePath(), `${id}\n`);
}

export function clearActiveIfMatches(id: string): void {
  if (readPointer(activePath()) === id) rmSync(activePath(), { force: true });
}

export function readPinnedId(): string | null {
  return readPointer(pinnedPath());
}

export function writePinnedId(id: string): void {
  writeFileAtomic(pinnedPath(), `${id}\n`);
}

export function clearPinned(): void {
  rmSync(pinnedPath(), { force: true });
}

export function clearPinnedIfMatches(id: string): void {
  if (readPointer(pinnedPath()) === id) clearPinned();
}

export function nowIso(): string {
  return new Date().toISOString();
}
