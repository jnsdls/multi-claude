// PROTOTYPE, throwaway. Stands in for t3/code: a real Agent SDK query() with
// streaming input, canUseTool, inline settings, settingSources, a generated
// --session-id, and the wrapper as pathToClaudeCodeExecutable. Runs a scenario
// of prompts, injecting the wall through the proxy where the scenario says.
import { query } from "/tmp/mclaude-proto/sdk-host/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs";
import { appendFileSync, writeFileSync, rmSync } from "node:fs";
const P = "/tmp/mclaude-proto";
const t0 = Date.now();
const log = (s: string) => appendFileSync(`${P}/host.log`, `${String(Date.now() - t0).padStart(6)} ${s}\n`);
const scenarios: Record<string, { prompt: string; trigger?: string; after?: number; retry?: boolean }[]> = {
  retry: [
    { prompt: "Run the shell command `touch /tmp/mclaude-proto/work/before-handoff.txt && echo done` with the Bash tool and reply with only its output." },
    { prompt: "Reply with exactly the word banana.", trigger: "five_hour", retry: true, after: 25000 },
    { prompt: "Which words did I ask you to reply with so far? One line." },
  ],
  wall: [
    { prompt: "Reply with exactly the word apple." },
    { prompt: "Reply with exactly the word banana.", trigger: "five_hour", after: 25000 },
    { prompt: "Run the shell command `touch /tmp/mclaude-proto/work/after-handoff.txt && echo done` with the Bash tool and reply with only its output." },
    { prompt: "Which words did I ask you to reply with so far? One line." },
  ],
  midturn: [
    { prompt: "Reply with exactly the word apple." },
    { prompt: "Using the Bash tool one command at a time: run `echo one`, then `echo two`, then `echo three`, each as its own tool call, then reply with the three outputs joined by commas.", trigger: "main:6", after: 40000 },
    { prompt: "Which words did I ask you to reply with so far? One line." },
  ],
};
const steps = scenarios[process.argv[2] ?? "wall"];
const resume = process.argv[3];
const sid = resume ?? crypto.randomUUID();
let turnDone: (() => void) | undefined; let lastErr = false;
async function* input() {
  for (const s of steps) {
    if (s.trigger) { writeFileSync(`${P}/limit`, s.trigger); log(`trigger ${s.trigger}`); }
    const done = new Promise<void>((r) => (turnDone = r));
    log(`send user: ${s.prompt}`);
    yield { type: "user" as const, message: { role: "user" as const, content: s.prompt }, parent_tool_use_id: null, session_id: sid };
    await done;
    if (s.trigger) { rmSync(`${P}/limit`, { force: true }); log("untrigger"); }
    if (s.retry && lastErr) { const d2 = new Promise<void>((r) => (turnDone = r)); log(`host retries: ${s.prompt}`); yield { type: "user" as const, message: { role: "user" as const, content: s.prompt }, parent_tool_use_id: null, session_id: sid }; await d2; }
    if (s.after) { log(`waiting ${s.after}ms`); await Bun.sleep(s.after); }
  }
  log("input done");
}
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k)));
const q = query({
  prompt: input(),
  options: {
    pathToClaudeCodeExecutable: `${import.meta.dir}/mclaude-sdk`,
    cwd: `${P}/work`, model: "haiku",
    ...(resume ? { resume } : { sessionId: sid }),
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    settings: { alwaysThinkingEnabled: false },
    permissionMode: (process.env.PROTO_PERM as any) ?? "acceptEdits",
    includePartialMessages: true,
    canUseTool: async (name: string, inp: any) => { log(`canUseTool ${name} ${JSON.stringify(inp).slice(0, 80)}`); return { behavior: "allow", updatedInput: inp }; },
    env: cleanEnv,
    stderr: (d: string) => log(`stderr: ${d.trim().slice(0, 200)}`),
  },
});
let partial = 0;
try {
  for await (const m of q as any) {
    if (m.type === "stream_event") { partial++; continue; }
    const extra = m.type === "result" ? ` is_error=${m.is_error} result=${JSON.stringify(m.result).slice(0, 100)} errors=${JSON.stringify(m.errors ?? [])}`
      : m.type === "assistant" ? ` ${JSON.stringify(m.message.content).slice(0, 140)}${m.error ? " error=" + m.error : ""}`
      : m.type === "rate_limit_event" ? ` ${JSON.stringify(m.rate_limit_info ?? m).slice(0, 160)}`
      : m.type === "system" && m.subtype === "init" ? ` session=${m.session_id} model=${m.model} pid?`
      : m.type === "user" ? ` ${JSON.stringify(m.message.content).slice(0, 120)}`
      : "";
    log(`recv ${m.type}${m.subtype ? "/" + m.subtype : ""} sid=${m.session_id ?? "-"}${extra}`);
    if (m.type === "result") { lastErr = !!m.is_error; turnDone?.(); }
  }
  log(`stream ended cleanly (partials=${partial})`);
} catch (e: any) { log(`STREAM ERROR: ${e?.message ?? e}`); }
