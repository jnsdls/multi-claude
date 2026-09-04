// The Refresh trigger (ADR 0002): a `claude -p` run whose only job is to make
// Claude Code renew a token about to expire and store it. The model call goes
// to a closed loopback port, so nothing is spent and no transcript is written.
import { needsLogin, readCredential, type OAuthCredential } from "./credential.ts";
import { buildChildEnv } from "./env.ts";
import { runCaptured } from "./spawn.ts";

/** Claude Code's own "needs refresh" test: five minutes before expiry. */
export const REFRESH_MARGIN_MS = 300_000;
/** A real run takes about a second; this is only a guard against a wedged claude. */
export const REFRESH_TIMEOUT_MS = 15_000;

export const REFRESH_ARGV = [
  "-p",
  "hi",
  "--max-turns",
  "1",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
];

/** Port 9 refuses instantly; CLAUDE_CODE_MAX_RETRIES=0 keeps claude from retrying for two minutes. */
export const REFRESH_ENV = { ANTHROPIC_BASE_URL: "http://127.0.0.1:9", CLAUDE_CODE_MAX_RETRIES: "0" };

export type RefreshOutcome = "fresh" | "needs-login" | "unknown";

/** Due when `now + 300 s` reaches `expiresAt`. A credential that already Needs login is never triggered. */
export function refreshDue(cred: OAuthCredential | null, now: number): boolean {
  if (needsLogin(cred)) return false;
  return now + REFRESH_MARGIN_MS >= cred!.expiresAt;
}

/** Exit code is 1 in every outcome, so the result is read from the credential. Pure. */
export function classifyRefresh(before: OAuthCredential, after: OAuthCredential | null): RefreshOutcome {
  if (!after) return "unknown";
  if (after.accessToken === "" && after.refreshToken === "" && after.expiresAt === 0) return "needs-login";
  if (after.expiresAt > before.expiresAt) return "fresh";
  return "unknown";
}

export interface RefreshResult {
  outcome: RefreshOutcome;
  /** The credential as re-read after the run. */
  credential: OAuthCredential | null;
}

export async function runRefreshTrigger(
  claudePath: string,
  accountDir: string,
  accountId: string,
  before: OAuthCredential,
): Promise<RefreshResult> {
  const env = buildChildEnv({ accountDir, accountId, extra: REFRESH_ENV });
  try {
    await runCaptured(claudePath, REFRESH_ARGV, env, {
      cwd: accountDir,
      timeoutMs: REFRESH_TIMEOUT_MS,
      stdin: "ignore",
    });
  } catch {
    // A spawn failure reads the same as an unchanged credential below.
  }
  const credential = await readCredential(accountDir);
  return { outcome: classifyRefresh(before, credential), credential };
}
