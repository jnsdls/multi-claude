// The scripted fake claude. Driven by <FAKE_CLAUDE_STATE>/scenario.json; records
// every call to <FAKE_CLAUDE_STATE>/calls/<seq>.json. See harness.ts for the
// scenario shape.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const state = process.env.FAKE_CLAUDE_STATE;
if (!state) {
  process.stderr.write("fake claude: FAKE_CLAUDE_STATE not set\n");
  process.exit(2);
}
const scenario = existsSync(join(state, "scenario.json"))
  ? JSON.parse(readFileSync(join(state, "scenario.json"), "utf8"))
  : {};
const argv = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR;

function nextSeq(): number {
  const calls = join(state!, "calls");
  mkdirSync(calls, { recursive: true });
  for (let n = 0; ; n++) {
    try {
      mkdirSync(join(calls, `${n}.d`));
      return n;
    } catch {
      // taken
    }
  }
}
const seq = nextSeq();
const record: Record<string, unknown> = {
  seq,
  pid: process.pid,
  argv,
  env: process.env,
  cwd: process.cwd(),
  startedAt: Date.now(),
  stdinLines: [] as string[],
};
function save(extra: Record<string, unknown> = {}) {
  Object.assign(record, extra);
  writeFileSync(join(state!, "calls", `${seq}.json`), JSON.stringify(record));
}
save();

function flagValue(name: string): string | undefined {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return argv[i]!.includes("=") ? argv[i]!.slice(name.length + 1) : argv[i + 1];
}

// --version
if (argv.includes("--version") || argv.includes("-v")) {
  process.stdout.write(`${scenario.version ?? "2.1.259 (Claude Code)"}\n`);
  save({ kind: "version" });
  process.exit(scenario.versionExit ?? 0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(scenario.help ?? "Usage: claude [options] [command] [prompt]\n");
  save({ kind: "help" });
  process.exit(0);
}

// auth login / auth logout / auth status
if (argv[0] === "auth") {
  const sub = argv[1];
  if (sub === "login") {
    const login = scenario.login ?? {};
    if (login.sleepMs) await Bun.sleep(login.sleepMs);
    if (login.stdout) process.stdout.write(login.stdout);
    if (configDir) {
      const jsonPath = join(configDir, ".claude.json");
      let current: Record<string, unknown> = {};
      try {
        current = JSON.parse(readFileSync(jsonPath, "utf8"));
      } catch {
        current = {};
      }
      if (login.oauthAccount !== null) {
        current.oauthAccount = login.oauthAccount ?? {
          accountUuid: "acc-default",
          emailAddress: "user@example.com",
          organizationUuid: "org-default",
          organizationName: "Example Org",
        };
      }
      if (login.authMethod !== null) current.authMethod = login.authMethod ?? "claude.ai";
      if (login.extraClaudeJson) Object.assign(current, login.extraClaudeJson);
      writeFileSync(jsonPath, JSON.stringify(current, null, 2), { mode: 0o600 });
      if (login.credential !== null) {
        const cred = login.credential ?? {
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-fake",
            refreshToken: "sk-ant-ort01-fake",
            expiresAt: Date.now() + 8 * 3600_000,
            scopes: ["user:inference", "user:profile"],
            subscriptionType: "max",
          },
        };
        writeFileSync(join(configDir, ".credentials.json"), JSON.stringify(cred), { mode: 0o600 });
      }
    }
    save({ kind: "auth login" });
    process.exit(login.exit ?? 0);
  }
  if (sub === "logout") {
    const logout = scenario.logout ?? {};
    if (configDir && logout.keepCredential !== true) {
      try {
        const { rmSync } = await import("node:fs");
        rmSync(join(configDir, ".credentials.json"), { force: true });
      } catch {}
    }
    save({ kind: "auth logout" });
    process.exit(logout.exit ?? 0);
  }
  // auth status: loggedIn from the credential file, identity from the dir's .claude.json.
  save({ kind: "auth status" });
  if (!configDir || !existsSync(join(configDir, ".credentials.json"))) {
    process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`);
    process.exit(1);
  }
  let cj: Record<string, any> = {};
  try {
    cj = JSON.parse(readFileSync(join(configDir, ".claude.json"), "utf8"));
  } catch {}
  const login = scenario.login ?? {};
  process.stdout.write(
    `${JSON.stringify({
      loggedIn: true,
      authMethod: login.authMethod ?? "claude.ai",
      email: cj.oauthAccount?.emailAddress ?? null,
      orgName: cj.oauthAccount?.organizationName ?? null,
      subscriptionType: login.subscriptionType ?? "max",
    })}\n`,
  );
  process.exit(0);
}

// The Refresh trigger: -p with ANTHROPIC_BASE_URL at a closed port.
if ((argv.includes("-p") || argv.includes("--print")) && process.env.ANTHROPIC_BASE_URL?.startsWith("http://127.0.0.1:")) {
  const mode = scenario.refresh ?? "unchanged";
  if (configDir) {
    const credPath = join(configDir, ".credentials.json");
    try {
      const cred = JSON.parse(readFileSync(credPath, "utf8"));
      const o = cred.claudeAiOauth ?? {};
      if (mode === "advance") {
        o.accessToken = `sk-ant-oat01-refreshed-${Date.now()}`;
        o.refreshToken = `sk-ant-ort01-refreshed-${Date.now()}`;
        o.expiresAt = Date.now() + 8 * 3600_000;
      } else if (mode === "zero") {
        o.accessToken = "";
        o.refreshToken = "";
        o.expiresAt = 0;
      }
      cred.claudeAiOauth = o;
      writeFileSync(credPath, JSON.stringify(cred), { mode: 0o600 });
    } catch {}
  }
  save({ kind: "refresh" });
  process.exit(1);
}

// Everything else: a launch, driven by scenario.calls[launchIndex] or scenario.default.
const launchIndex = (() => {
  const calls = join(state!, "calls");
  let n = 0;
  for (let i = 0; i < seq; i++) {
    try {
      const r = JSON.parse(readFileSync(join(calls, `${i}.json`), "utf8"));
      if (r.kind === "launch") n++;
    } catch {}
  }
  return n;
})();
const calls: Record<string, unknown>[] = scenario.calls ?? [];
const behaviour: Record<string, any> = calls[launchIndex] ?? calls[calls.length - 1] ?? scenario.default ?? {};
save({ kind: "launch", launchIndex });

if (behaviour.ignoreSigterm) {
  process.on("SIGTERM", () => {
    save({ sawSigterm: true });
  });
}
if (behaviour.stdout) process.stdout.write(behaviour.stdout);
if (behaviour.stderr) process.stderr.write(behaviour.stderr);

const stdinLines: string[] = [];
let stdinDone: Promise<void> = Promise.resolve();
if (behaviour.echoStdin) {
  stdinDone = (async () => {
    let buf = "";
    for await (const chunk of Bun.stdin.stream()) {
      buf += Buffer.from(chunk).toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) {
          stdinLines.push(line);
          save({ stdinLines });
          if (behaviour.exitAfterStdinLines && stdinLines.length >= behaviour.exitAfterStdinLines) {
            save({ stdinLines, exitedOnStdin: true });
            process.exit(behaviour.exit ?? 0);
          }
        }
      }
    }
    save({ stdinLines, stdinClosed: true });
  })();
}

if (behaviour.transcript) {
  const t = behaviour.transcript;
  mkdirSync(join(t.path, ".."), { recursive: true });
  writeFileSync(t.path, t.lines.map((l: unknown) => JSON.stringify(l)).join("\n") + "\n");
}

async function runHooks() {
  for (const h of behaviour.hooks ?? []) {
    if (h.afterMs) await Bun.sleep(h.afterMs);
    const settingsPath = flagValue("--settings");
    if (!settingsPath) {
      save({ hookError: "no --settings on argv" });
      continue;
    }
    let settings: any;
    try {
      settings = settingsPath.trim().startsWith("{") ? JSON.parse(settingsPath) : JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (e) {
      save({ hookError: `settings unreadable: ${(e as Error).message}` });
      continue;
    }
    const entries = settings?.hooks?.[h.event] ?? [];
    const sessionId = flagValue("--session-id") ?? flagValue("--resume") ?? "unknown-session";
    const payload = {
      session_id: sessionId,
      transcript_path: behaviour.transcript?.path ?? join(state!, "transcript.jsonl"),
      cwd: process.cwd(),
      hook_event_name: h.event,
      ...(h.payload ?? {}),
    };
    let ran = 0;
    for (const entry of entries) {
      if (entry.matcher && h.event === "StopFailure" && !new RegExp(entry.matcher).test(String(payload.error ?? ""))) continue;
      for (const hook of entry.hooks ?? []) {
        if (hook.type !== "command") continue;
        const p = Bun.spawn(["sh", "-c", hook.command], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
        p.stdin.write(JSON.stringify(payload));
        p.stdin.end();
        await p.exited;
        ran++;
      }
    }
    save({ [`hooksRan_${h.event}`]: ran });
  }
}

await runHooks();
if (behaviour.sleepMs) await Bun.sleep(behaviour.sleepMs);
if (behaviour.waitForStdinClose) await stdinDone;
if (behaviour.exitSignal) {
  process.kill(process.pid, behaviour.exitSignal);
  await Bun.sleep(1000);
}
save({ exitedAt: Date.now() });
process.exit(behaviour.exit ?? 0);
