// The stored OAuth credential, read and never written (ADR 0002). macOS keeps it
// in a Keychain item named by a hash of the Account dir string; Linux and a
// locked Keychain keep it in <accountDir>/.credentials.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OAuthCredential {
  accessToken: string;
  refreshToken: string;
  /** Millisecond epoch, as Claude Code stores it. */
  expiresAt: number;
  scopes: string[];
  subscriptionType: string | null;
}

/**
 * Claude Code hashes the raw CLAUDE_SECURESTORAGE_CONFIG_DIR string, NFC-normalised,
 * never realpath'd. A different string is a different item (ADR 0004).
 */
export function keychainServiceName(accountDir: string): string {
  const digest = createHash("sha256").update(accountDir.normalize("NFC")).digest("hex");
  return `Claude Code-credentials-${digest.slice(0, 8)}`;
}

/** A bare string (an API key) or anything without claudeAiOauth is no OAuth credential. */
export function parseCredential(text: string): OAuthCredential | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = (raw as Record<string, unknown>).claudeAiOauth;
  if (!o || typeof o !== "object") return null;
  const c = o as Record<string, unknown>;
  return {
    accessToken: typeof c.accessToken === "string" ? c.accessToken : "",
    refreshToken: typeof c.refreshToken === "string" ? c.refreshToken : "",
    expiresAt: typeof c.expiresAt === "number" ? c.expiresAt : 0,
    scopes: Array.isArray(c.scopes) ? c.scopes.filter((s): s is string => typeof s === "string") : [],
    subscriptionType: typeof c.subscriptionType === "string" ? c.subscriptionType : null,
  };
}

/** `security` answers at once or hangs on a locked Keychain; wait this long before giving up. */
const KEYCHAIN_TIMEOUT_MS = 2_000;

/** Exit 44 means no item. Any other failure, a timeout included, also falls back to the file. */
async function readKeychain(accountDir: string): Promise<string | null> {
  const user = process.env.USER;
  if (!user) return null;
  const child = Bun.spawn(
    ["/usr/bin/security", "find-generic-password", "-a", user, "-s", keychainServiceName(accountDir), "-w"],
    { stdin: "ignore", stdout: "pipe", stderr: "ignore" },
  );
  const timer = setTimeout(() => child.kill("SIGKILL"), KEYCHAIN_TIMEOUT_MS);
  try {
    const out = await new Response(child.stdout as ReadableStream).text();
    const code = await child.exited;
    return code === 0 ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCredentialFile(accountDir: string): string | null {
  try {
    return readFileSync(join(accountDir, ".credentials.json"), "utf8");
  } catch {
    return null;
  }
}

export async function readCredential(accountDir: string): Promise<OAuthCredential | null> {
  if (process.platform === "darwin") {
    const item = await readKeychain(accountDir);
    if (item !== null) {
      const cred = parseCredential(item);
      if (cred) return cred;
    }
  }
  const file = readCredentialFile(accountDir);
  return file === null ? null : parseCredential(file);
}

/** Needs login: credential absent, or accessToken empty, or refreshToken empty, or expiresAt 0. */
export function needsLogin(cred: OAuthCredential | null): boolean {
  return !cred || cred.accessToken === "" || cred.refreshToken === "" || cred.expiresAt === 0;
}
