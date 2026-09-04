// Extracts the flag and command names from `claude --help` (ADR 0012), plus
// each flag's arity. Only names and arities are kept, so wording changes never
// show up in the drift diff.
//
//   bun run scripts/extract-claude-help.ts [path-to-claude] > fixtures/claude-help.json
//
// The parser is exported so a test can feed it a fixed help text.
import { parseVersion } from "../src/version.ts";

/** How many values a flag takes: `<x>` one, `<x...>` variadic, `[x]` optional, nothing boolean. */
export type FlagArity = "none" | "one" | "optional" | "variadic";

export interface HelpNames {
  version: string;
  flags: string[];
  commands: string[];
  flagArity: Record<string, FlagArity>;
}

/** Section headings in commander's help output. */
const SECTION = /^(\S.*):\s*$/;

/** The value placeholder after the names: `<x>`, `<x...>`, `[x]` or `[x...]`. */
function arityOf(spec: string): FlagArity {
  const m = /(<[^>]*>|\[[^\]]*\])/.exec(spec);
  if (!m) return "none";
  const placeholder = m[1]!;
  if (placeholder.includes("...")) return "variadic";
  return placeholder.startsWith("<") ? "one" : "optional";
}

/**
 * Pulls flag names and arities from the Options section and command names from
 * the Commands section. An entry line is indented by exactly two spaces; deeper
 * indents are description continuations. `--allowedTools, --allowed-tools
 * <tools...>` gives both names, each variadic; `plugin|plugins` gives both
 * commands.
 */
export function parseHelpNames(help: string): { flags: string[]; commands: string[]; flagArity: Record<string, FlagArity> } {
  const flags = new Set<string>();
  const commands = new Set<string>();
  const flagArity: Record<string, FlagArity> = {};
  let section = "";
  for (const line of help.split("\n")) {
    const heading = SECTION.exec(line);
    if (heading) {
      section = heading[1]!.toLowerCase();
      continue;
    }
    const entry = /^ {2}(\S.*)$/.exec(line);
    if (!entry) continue;
    const text = entry[1]!;
    if (section === "options") {
      const spec = text.split(/ {2,}/)[0]!;
      const arity = arityOf(spec);
      for (const part of spec.split(",")) {
        const name = part.trim().split(/\s+/)[0];
        if (name && name.startsWith("-")) {
          flags.add(name);
          flagArity[name] = arity;
        }
      }
    } else if (section === "commands") {
      const word = text.split(/\s+/)[0]!;
      for (const name of word.split("|")) {
        if (/^[A-Za-z][\w-]*$/.test(name)) commands.add(name);
      }
    }
  }
  const sortedFlags = [...flags].sort();
  return { flags: sortedFlags, commands: [...commands].sort(), flagArity: Object.fromEntries(sortedFlags.map((f) => [f, flagArity[f]!])) };
}

async function capture(claude: string, argv: string[]): Promise<string> {
  const p = Bun.spawn([claude, ...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout as ReadableStream).text();
  const code = await p.exited;
  if (code !== 0) throw new Error(`${claude} ${argv.join(" ")} exited ${code}`);
  return out;
}

/** Runs the given claude binary and returns its names plus its version. */
export async function extractFromClaude(claude: string): Promise<HelpNames> {
  const [help, versionText] = await Promise.all([capture(claude, ["--help"]), capture(claude, ["--version"])]);
  const parsed = parseVersion(versionText);
  const version = parsed ? parsed.join(".") : versionText.trim();
  return { version, ...parseHelpNames(help) };
}

export function resolveClaudeForScripts(argv: string[]): string {
  const given = argv[0] ?? process.env.MCLAUDE_CLAUDE_PATH ?? Bun.which("claude");
  if (!given) {
    console.error("claude not found: pass a path or put claude on PATH");
    process.exit(69);
  }
  return given;
}

if (import.meta.main) {
  const names = await extractFromClaude(resolveClaudeForScripts(process.argv.slice(2)));
  console.log(JSON.stringify(names, null, 2));
}
