// Shared pieces of the `account` commands: name resolution, alias rules, the
// login flow `add` and `login` both run, and claude's path.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClaude } from "../../claude-path.ts";
import { loadConfigFile, resolveSettings } from "../../config.ts";
import { buildChildEnv } from "../../env.ts";
import { EXIT, ExitError } from "../../exit.ts";
import { listRecords, nowIso, resolveAccount, type AccountRecord, type Identity } from "../../record.ts";
import { forwardSignals, runCaptured, spawnClaude } from "../../spawn.ts";

/** `add` and `login` read claudePath from config.json; every other account command never opens it. */
export function claudeForLogin(): string {
  return resolveClaude(resolveSettings({}, loadConfigFile()));
}

/** Without config.json: MCLAUDE_CLAUDE_PATH, PATH, ~/.local/bin. Null when claude is not there. */
export function claudeWithoutConfig(): string | null {
  try {
    return resolveClaude(resolveSettings({}, {}));
  } catch {
    return null;
  }
}

/** Exact id first, then Alias. Unknown is a usage error. */
export function requireAccount(name: string | undefined, records: AccountRecord[] = listRecords()): AccountRecord {
  if (!name) throw new ExitError(EXIT.USAGE, "an Account id or Alias is required");
  const r = resolveAccount(name, records);
  if (!r) throw new ExitError(EXIT.USAGE, `no Account named "${name}"`);
  return r;
}

/** An Alias may not equal any id or any other Account's Alias, and must look like an argument. */
export function assertAliasFree(alias: string, records: AccountRecord[], exceptId?: string): void {
  if (alias === "" || alias.startsWith("-")) throw new ExitError(EXIT.USAGE, `"${alias}" is not a usable Alias`);
  for (const r of records) {
    if (r.id === exceptId) continue;
    if (r.id === alias || r.alias === alias) {
      throw new ExitError(EXIT.USAGE, `"${alias}" is already the ${r.id === alias ? "id" : "Alias"} of ${r.alias} (${r.id})`);
    }
  }
}

export function sameIdentity(a: Pick<Identity, "accountUuid" | "organizationUuid">, b: Pick<Identity, "accountUuid" | "organizationUuid">): boolean {
  return a.accountUuid === b.accountUuid && a.organizationUuid === b.organizationUuid;
}

export interface LoginFlags {
  email?: string;
  sso?: boolean;
}

/**
 * Parses `[--email <e>] [--sso]` out of argv, returning the positionals. Any
 * other flag, `--console` included, is refused: claude's other login modes
 * produce credentials mclaude cannot read usage for.
 */
export function parseLoginFlags(args: string[]): { positionals: string[]; flags: LoginFlags } {
  const flags: LoginFlags = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--email") {
      const v = args[++i];
      if (v === undefined) throw new ExitError(EXIT.USAGE, "--email needs a value");
      flags.email = v;
    } else if (a.startsWith("--email=")) {
      flags.email = a.slice("--email=".length);
    } else if (a === "--sso") {
      flags.sso = true;
    } else if (a.startsWith("-")) {
      throw new ExitError(EXIT.USAGE, `flag "${a}" is not accepted here; only --email <e> and --sso reach claude auth login`);
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function readOauthAccount(dir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
    const o = raw?.oauthAccount;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * `claude auth login` in the Account dir with inherited stdio, then the checks
 * every login passes: exit zero, an oauthAccount in the dir's .claude.json, and
 * authMethod claude.ai from `claude auth status`. Throws ExitError(1) on any of
 * them; the caller owns the rollback.
 */
export async function loginInDir(claudePath: string, dir: string, id: string, flags: LoginFlags): Promise<Identity> {
  const argv = ["auth", "login"];
  if (flags.email !== undefined) argv.push("--email", flags.email);
  if (flags.sso) argv.push("--sso");
  const env = buildChildEnv({ accountDir: dir, accountId: id });
  const child = spawnClaude(claudePath, { argv, env, cwd: dir });
  const stop = forwardSignals(() => child);
  try {
    await child.exited;
  } finally {
    stop();
  }
  if (child.exitCode !== 0) {
    throw new ExitError(EXIT.REFUSED, `claude auth login exited ${child.signalCode ?? child.exitCode}`);
  }
  const oauth = readOauthAccount(dir);
  if (!oauth || !str(oauth.accountUuid) || !str(oauth.organizationUuid)) {
    throw new ExitError(EXIT.REFUSED, "login finished but the Account dir holds no oauthAccount; nothing was added");
  }
  const status = await runCaptured(claudePath, ["auth", "status"], env, { cwd: dir, timeoutMs: 10_000 });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    parsed = {};
  }
  const authMethod = str(parsed.authMethod);
  if (authMethod !== "claude.ai") {
    throw new ExitError(
      EXIT.REFUSED,
      `login used authMethod "${authMethod || "unknown"}"; mclaude only manages claude.ai subscription logins`,
    );
  }
  return {
    accountUuid: str(oauth.accountUuid),
    organizationUuid: str(oauth.organizationUuid),
    email: str(oauth.emailAddress),
    organizationName: str(oauth.organizationName),
    subscriptionType: str(parsed.subscriptionType) || null,
    capturedAt: nowIso(),
  };
}

/** `claude auth logout` in the dir with captured output. Returns whether it succeeded. */
export async function logoutInDir(claudePath: string | null, dir: string, id: string): Promise<boolean> {
  if (!claudePath) return false;
  try {
    const env = buildChildEnv({ accountDir: dir, accountId: id });
    const r = await runCaptured(claudePath, ["auth", "logout"], env, { cwd: dir, timeoutMs: 10_000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/** The one stdout line `add` and `login` print. */
export function identityLine(record: AccountRecord): string {
  return `${record.alias} ${record.id} ${record.identity.email} ${record.identity.subscriptionType ?? "-"}\n`;
}
