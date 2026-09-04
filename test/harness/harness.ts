// The process-seam harness: spawns the built bin/mclaude with MCLAUDE_HOME in a
// fresh temp dir, HOME pointing at a temp Shared home, MCLAUDE_CLAUDE_PATH at the
// fake claude and MCLAUDE_USAGE_URL at a local usage server when one is started.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUsageServer, type UsageServer, type UsageScenario } from "./usage-server.ts";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const BIN = join(REPO_ROOT, "bin", "mclaude");
export const FAKE_CLAUDE_TS = join(import.meta.dir, "fake-claude.ts");

export interface Scenario {
  version?: string;
  versionExit?: number;
  help?: string;
  login?: {
    exit?: number;
    sleepMs?: number;
    stdout?: string;
    oauthAccount?: Record<string, unknown> | null;
    authMethod?: string | null;
    subscriptionType?: string;
    credential?: Record<string, unknown> | null;
    extraClaudeJson?: Record<string, unknown>;
  };
  logout?: { exit?: number; keepCredential?: boolean };
  refresh?: "advance" | "zero" | "unchanged";
  calls?: CallBehaviour[];
  default?: CallBehaviour;
}

export interface CallBehaviour {
  exit?: number;
  sleepMs?: number;
  ignoreSigterm?: boolean;
  stdout?: string;
  stderr?: string;
  exitSignal?: string;
  echoStdin?: boolean;
  exitAfterStdinLines?: number;
  waitForStdinClose?: boolean;
  transcript?: { path: string; lines: unknown[] };
  hooks?: { afterMs?: number; event: "StopFailure" | "SessionStart"; payload?: Record<string, unknown> }[];
}

export interface CallRecord {
  seq: number;
  pid: number;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  kind: string;
  launchIndex?: number;
  stdinLines?: string[];
  [k: string]: unknown;
}

export interface RunResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface PlantAccountOptions {
  id?: string;
  alias?: string;
  email?: string;
  accountUuid?: string;
  organizationUuid?: string;
  subscriptionType?: string | null;
  disabled?: boolean;
  addedAt?: string;
  /** null plants no credential (Needs login). */
  credential?: Record<string, unknown> | null;
  expiresAt?: number;
  usage?: Record<string, unknown>;
  lastLimit?: Record<string, unknown> | null;
  claudeJson?: Record<string, unknown>;
  active?: boolean;
}

export class Harness {
  readonly root: string;
  readonly home: string;
  readonly sharedHome: string;
  readonly mclaudeHome: string;
  readonly fakeState: string;
  readonly fakeClaude: string;
  usage: UsageServer | null = null;
  private counter = 0;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "mclaude-test-"));
    this.home = join(this.root, "home");
    this.sharedHome = join(this.home, ".claude");
    this.mclaudeHome = join(this.root, "mclaude-home");
    this.fakeState = join(this.root, "fake");
    mkdirSync(this.sharedHome, { recursive: true });
    mkdirSync(join(this.sharedHome, "projects"), { recursive: true });
    mkdirSync(this.mclaudeHome, { recursive: true, mode: 0o700 });
    mkdirSync(this.fakeState, { recursive: true });
    writeFileSync(join(this.home, ".claude.json"), JSON.stringify({ theme: "dark", hasCompletedOnboarding: true, projects: {} }));
    writeFileSync(join(this.sharedHome, "settings.json"), "{}\n");
    this.fakeClaude = join(this.root, "claude");
    writeFileSync(this.fakeClaude, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLAUDE_TS}" "$@"\n`);
    chmodSync(this.fakeClaude, 0o755);
  }

  scenario(s: Scenario): void {
    writeFileSync(join(this.fakeState, "scenario.json"), JSON.stringify(s));
  }

  env(extra: Record<string, string | undefined> = {}): Record<string, string> {
    const base: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: this.home,
      USER: process.env.USER ?? "tester",
      MCLAUDE_HOME: this.mclaudeHome,
      MCLAUDE_CLAUDE_PATH: this.fakeClaude,
      FAKE_CLAUDE_STATE: this.fakeState,
      TERM: process.env.TERM ?? "xterm",
    };
    if (this.usage) base.MCLAUDE_USAGE_URL = this.usage.url;
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete base[k];
      else base[k] = v;
    }
    return base;
  }

  async run(
    args: string[],
    opts: { env?: Record<string, string | undefined>; stdin?: string | "pipe" | "ignore"; cwd?: string; timeoutMs?: number } = {},
  ): Promise<RunResult> {
    const child = Bun.spawn([BIN, ...args], {
      env: this.env(opts.env),
      cwd: opts.cwd ?? this.root,
      stdin: opts.stdin === undefined ? "ignore" : opts.stdin === "pipe" ? "pipe" : opts.stdin === "ignore" ? "ignore" : new TextEncoder().encode(opts.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
    ]);
    await child.exited;
    clearTimeout(timer);
    return { exitCode: child.exitCode, signal: child.signalCode, stdout, stderr };
  }

  /** Spawns mclaude and returns the process for tests that drive stdin or signals. */
  spawn(args: string[], opts: { env?: Record<string, string | undefined>; cwd?: string; stdin?: "pipe" | "ignore" } = {}) {
    return Bun.spawn([BIN, ...args], {
      env: this.env(opts.env),
      cwd: opts.cwd ?? this.root,
      stdin: opts.stdin ?? "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  calls(): CallRecord[] {
    const dir = join(this.fakeState, "calls");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CallRecord)
      .sort((a, b) => a.seq - b.seq);
  }

  launches(): CallRecord[] {
    return this.calls().filter((c) => c.kind === "launch");
  }

  async waitFor(pred: () => boolean, timeoutMs = 5000, stepMs = 25): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (pred()) return true;
      await Bun.sleep(stepMs);
    }
    return pred();
  }

  accountDir(id: string): string {
    return join(this.mclaudeHome, "accounts", id);
  }

  readRecord(id: string): any {
    return JSON.parse(readFileSync(join(this.mclaudeHome, "state", `${id}.json`), "utf8"));
  }

  readActive(): string | null {
    try {
      return readFileSync(join(this.mclaudeHome, "active"), "utf8").trim();
    } catch {
      return null;
    }
  }

  readPinned(): string | null {
    try {
      return readFileSync(join(this.mclaudeHome, "pinned"), "utf8").trim();
    } catch {
      return null;
    }
  }

  writeConfig(text: string): void {
    writeFileSync(join(this.mclaudeHome, "config.json"), text);
  }

  /** Plants an Account dir and Record by hand, the way `account add` would leave them. */
  plantAccount(o: PlantAccountOptions = {}): string {
    const n = ++this.counter;
    const id = o.id ?? `acct${n}xx`.slice(0, 8);
    const email = o.email ?? `user${n}@example.com`;
    const dir = this.accountDir(id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const claudeJson = {
      oauthAccount: {
        accountUuid: o.accountUuid ?? `acc-${id}`,
        emailAddress: email,
        organizationUuid: o.organizationUuid ?? `org-${id}`,
        organizationName: "Example Org",
      },
      hasCompletedOnboarding: true,
      projects: {},
      ...(o.claudeJson ?? {}),
    };
    writeFileSync(join(dir, ".claude.json"), JSON.stringify(claudeJson, null, 2), { mode: 0o600 });
    if (o.credential !== null) {
      const cred = o.credential ?? {
        claudeAiOauth: {
          accessToken: `sk-ant-oat01-${id}`,
          refreshToken: `sk-ant-ort01-${id}`,
          expiresAt: o.expiresAt ?? Date.now() + 8 * 3600_000,
          scopes: ["user:inference", "user:profile"],
          subscriptionType: o.subscriptionType ?? "max",
        },
      };
      writeFileSync(join(dir, ".credentials.json"), JSON.stringify(cred), { mode: 0o600 });
    }
    const record = {
      version: 1,
      id,
      alias: o.alias ?? email,
      addedAt: o.addedAt ?? new Date(Date.now() - n * 60_000).toISOString(),
      disabled: o.disabled ?? false,
      identity: {
        accountUuid: o.accountUuid ?? `acc-${id}`,
        organizationUuid: o.organizationUuid ?? `org-${id}`,
        email,
        organizationName: "Example Org",
        subscriptionType: o.subscriptionType === undefined ? "max" : o.subscriptionType,
        capturedAt: new Date().toISOString(),
      },
      usage: {
        lastGood: null,
        fetchedAt: null,
        lastAttemptAt: null,
        backoffUntil: null,
        last429At: null,
        ...(o.usage ?? {}),
      },
      lastLimit: o.lastLimit ?? null,
    };
    mkdirSync(join(this.mclaudeHome, "state"), { recursive: true, mode: 0o700 });
    writeFileSync(join(this.mclaudeHome, "state", `${id}.json`), JSON.stringify(record, null, 2), { mode: 0o600 });
    if (o.active) this.setActive(id);
    return id;
  }

  setActive(id: string): void {
    writeFileSync(join(this.mclaudeHome, "active"), `${id}\n`);
  }

  setPinned(id: string): void {
    writeFileSync(join(this.mclaudeHome, "pinned"), `${id}\n`);
  }

  /** Plants an Orphan: a dir with no Record. */
  plantOrphan(id = "orphan01"): string {
    mkdirSync(this.accountDir(id), { recursive: true, mode: 0o700 });
    return id;
  }

  async startUsage(scenario: UsageScenario = {}): Promise<UsageServer> {
    this.usage = await startUsageServer(scenario);
    return this.usage;
  }

  cleanup(): void {
    this.usage?.stop();
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** A healthy usage body with the given percentages. */
export function usageBody(o: {
  session?: number;
  week?: number;
  sessionResetsAt?: string | null;
  weekResetsAt?: string | null;
  scoped?: { name: string; percent: number; resetsAt?: string | null }[];
  credits?: boolean;
  spendLimitReached?: boolean;
} = {}): Record<string, unknown> {
  const sessionReset = o.sessionResetsAt === undefined ? new Date(Date.now() + 3 * 3600_000).toISOString() : o.sessionResetsAt;
  const weekReset = o.weekResetsAt === undefined ? new Date(Date.now() + 3 * 86400_000).toISOString() : o.weekResetsAt;
  const session = o.session ?? 10;
  const week = o.week ?? 5;
  const limits: unknown[] = [
    { kind: "session", group: "session", percent: session, severity: "normal", resets_at: sessionReset, scope: null, is_active: true },
    { kind: "weekly_all", group: "weekly", percent: week, severity: "normal", resets_at: weekReset, scope: null, is_active: false },
  ];
  for (const s of o.scoped ?? []) {
    limits.push({
      kind: "weekly_scoped",
      group: "weekly",
      percent: s.percent,
      severity: "normal",
      resets_at: s.resetsAt === undefined ? weekReset : s.resetsAt,
      scope: { model: { id: null, display_name: s.name }, surface: null },
      is_active: false,
    });
  }
  return {
    five_hour: { utilization: session, resets_at: sessionReset },
    seven_day: { utilization: week, resets_at: weekReset },
    extra_usage: { is_enabled: o.credits ?? false, spend_limit_reached: o.spendLimitReached ?? false },
    limits,
  };
}
