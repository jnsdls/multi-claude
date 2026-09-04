// `mclaude version`: mclaude's version, the resolved claude path and its version,
// the Bun version, the Checked version and the Version floor. Never opens config.json.
import { resolveClaude } from "../claude-path.ts";
import { buildChildEnv } from "../env.ts";
import { ExitError } from "../exit.ts";
import { readActiveId } from "../record.ts";
import { accountDir } from "../paths.ts";
import { runCaptured } from "../spawn.ts";
import { CHECKED_VERSION, compareVersions, parseVersion, VERSION, VERSION_FLOOR } from "../version.ts";

export async function probeClaudeVersion(claudePath: string): Promise<string> {
  const active = readActiveId();
  const env = buildChildEnv(active ? { accountDir: accountDir(active), accountId: active } : {});
  const r = await runCaptured(claudePath, ["--version"], env, { timeoutMs: 10_000 });
  return r.stdout.trim();
}

export async function runVersionCommand(): Promise<number> {
  const lines: string[] = [`mclaude ${VERSION}`];
  let claudePath: string | null = null;
  try {
    claudePath = resolveClaude({ claudePath: process.env.MCLAUDE_CLAUDE_PATH ? { value: process.env.MCLAUDE_CLAUDE_PATH, source: "env" } : undefined });
  } catch (e) {
    if (!(e instanceof ExitError)) throw e;
  }
  if (claudePath) {
    const text = await probeClaudeVersion(claudePath);
    const parsed = parseVersion(text);
    const checked = parseVersion(CHECKED_VERSION)!;
    const marker = parsed && compareVersions(parsed, checked) > 0 ? " (newer than checked)" : "";
    lines.push(`claude ${text || "(no version output)"}${marker}`);
    lines.push(`claude path ${claudePath}`);
  } else {
    lines.push("claude not found");
  }
  lines.push(`bun ${Bun.version}`);
  lines.push(`checked version ${CHECKED_VERSION}`);
  lines.push(`version floor ${VERSION_FLOOR}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
