// PROTOTYPE, throwaway. Minimal Handoff: launch claude under Account a with a
// generated --session-id and the Limit hook; on a StopFailure Signal, kill the
// child and relaunch `claude --resume <id> <original args>` under Account b.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, appendFileSync, rmSync } from "node:fs";
const P = "/tmp/mclaude-proto";
const HOME = process.env.HOME!;
const KILL = process.env.PROTO_KILL ?? "SIGTERM";
const RESET = process.env.PROTO_RESET === "1";
const RESEND = process.env.PROTO_RESEND === "1";
const args = process.argv.slice(2);
const sid = crypto.randomUUID();
const limitDir = `${P}/limits/${sid}`;
const log = (s: string) => appendFileSync(`${P}/wrapper.log`, `${new Date().toISOString()} ${s}\n`);
mkdirSync(limitDir, { recursive: true });
mkdirSync(`${P}/work`, { recursive: true });
const hookCmd = `${process.env.HOME}/.bun/bin/bun ${import.meta.dir}/hook.ts`;
writeFileSync(`${limitDir}/settings.json`, JSON.stringify({ hooks: {
  StopFailure: [{ matcher: "rate_limit", hooks: [{ type: "command", command: hookCmd }] }],
  SessionStart: [{ hooks: [{ type: "command", command: hookCmd }] }],
}}));
// Scrub markers inherited from the Claude Code session this prototype is driven from.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k)));
const seen = new Set<string>();
function spawn(account: string, extra: string[]) {
  const argv = ["claude", ...extra, ...args, "--settings", `${limitDir}/settings.json`];
  log(`spawn account=${account} argv=${JSON.stringify(argv)} kill=${KILL} reset=${RESET}`);
  return Bun.spawn(argv, {
    cwd: `${P}/work`, stdio: ["inherit", "inherit", "inherit"],
    env: { ...cleanEnv, CLAUDE_CONFIG_DIR: `${P}/accounts/${account}`, CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
      ANTHROPIC_BASE_URL: account === "a" ? "http://127.0.0.1:8788" : "http://127.0.0.1:8789", MCLAUDE_LIMIT_DIR: limitDir, MCLAUDE_ACCOUNT: account },
  });
}
let child = spawn("a", ["--session-id", sid]);
let handedOff = false;
const poll = setInterval(async () => {
  for (const f of readdirSync(limitDir)) {
    if (!f.endsWith(".json") || f === "settings.json" || seen.has(f)) continue;
    seen.add(f);
    const sig = JSON.parse(readFileSync(`${limitDir}/${f}`, "utf8"));
    log(`signal ${f} account=${sig.accountId} payload=${JSON.stringify(sig.payload)}`);
    if (!f.startsWith("StopFailure") || handedOff) continue;
    handedOff = true; clearInterval(poll);
    const t0 = Date.now();
    const tp = sig.payload.transcript_path;
    let last = -1, stable = 0;
    while (Date.now() - t0 < 3000) { const m = existsSync(tp) ? statSync(tp).mtimeMs : -2; if (m === last) { if (++stable >= 3) break; } else { stable = 0; last = m; } await Bun.sleep(100); }
    log(`transcript settled after ${Date.now() - t0}ms`);
    const tk = Date.now();
    child.kill(KILL as any);
    const code = await child.exited;
    log(`child exited code=${code} signal=${child.signalCode} ${Date.now() - tk}ms after ${KILL}`);
    const st = Bun.spawnSync(["stty", "-a"], { stdin: "inherit" });
    log(`stty after exit: ${st.stdout.toString().replace(/\n/g, " | ")}`);
    if (RESET) { process.stdout.write("\x1b[?1049l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[0m"); Bun.spawnSync(["stty", "sane"], { stdin: "inherit" }); log("terminal reset applied"); }
    const tr = Date.now();
    const resend: string[] = [];
    if (RESEND) {
      // Re-send the user turn the Limit rejected: last user entry in the transcript.
      const lines = readFileSync(tp, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const lastUser = [...lines].reverse().find((e) => e.type === "user" && typeof e.message?.content === "string");
      const lastEntry = [...lines].reverse().find((e) => e.type === "user" || e.type === "assistant");
      const errorAfterText = lastEntry?.isApiErrorMessage && lines[lines.indexOf(lastEntry) - 1]?.type === "user" && typeof lines[lines.indexOf(lastEntry) - 1]?.message?.content === "string";
      const text = errorAfterText ? lastUser!.message.content : "Continue where you left off. The previous attempt stopped at a usage limit.";
      resend.push(text); log(`resending ${JSON.stringify(text)} (errorAfterText=${errorAfterText})`);
    }
    child = spawn("b", ["--resume", sid, ...resend]);
    log(`relaunched ${tr - t0}ms after signal`);
    const c2 = await child.exited;
    log(`second child exited code=${c2}`);
    rmSync(limitDir, { recursive: true, force: true });
    process.exit(c2 ?? 0);
  }
}, 100);
child.exited.then((code) => { if (!handedOff) { log(`child exited on its own code=${code}`); clearInterval(poll); rmSync(limitDir, { recursive: true, force: true }); process.exit(code ?? 0); } });
