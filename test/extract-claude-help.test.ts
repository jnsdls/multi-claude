import { describe, expect, test } from "bun:test";
import { driftBetween, hasDrift, report } from "../scripts/check-drift.ts";
import { parseHelpNames } from "../scripts/extract-claude-help.ts";

const SAMPLE = `Usage: claude [options] [command] [prompt]

Claude Code - starts an interactive session by default, use -p/--print for
non-interactive output

Arguments:
  prompt                                Your prompt

Options:
  --add-dir <directories...>            Additional directories to allow tool
                                        access to
  --allowedTools, --allowed-tools <tools...>
      Comma or space-separated list of tool names to allow (e.g. "Bash(git *)
      Edit")
  --bg, --background                    Start the session in the background and
                                        return immediately. Prints the id that
                                        \`claude attach\`, \`logs\`, \`stop\` and \`rm\`
                                        take
  -c, --continue                        Continue the most recent conversation
  -d, --debug [filter]                  Enable debug mode with optional category
                                        filtering (e.g., "api,hooks" or
                                        "!1p,!file")
  --exclude-dynamic-system-prompt-sections
      Move per-machine sections from the system prompt into the first user
      message. (default: false)
  -r, --resume [value]                  Resume a conversation by session ID, or
                                        open interactive picker
  -v, --version                         Output the version number

Commands:
  agents [options]                      Manage background agents
  attach <id>                           Open a background session in this
                                        terminal. <id> is the short id that
                                        \`claude --bg\` prints
  plugin|plugins                        Manage Claude Code plugins
  stop|kill <id>                        Stop a background session
  update|upgrade                        Check for updates and install if
                                        available
`;

describe("parseHelpNames", () => {
  test("takes names and arities only, from the Options and Commands sections", () => {
    expect(parseHelpNames(SAMPLE)).toEqual({
      flags: [
        "--add-dir",
        "--allowed-tools",
        "--allowedTools",
        "--background",
        "--bg",
        "--continue",
        "--debug",
        "--exclude-dynamic-system-prompt-sections",
        "--resume",
        "--version",
        "-c",
        "-d",
        "-r",
        "-v",
      ],
      commands: ["agents", "attach", "kill", "plugin", "plugins", "stop", "update", "upgrade"],
      flagArity: {
        "--add-dir": "variadic",
        "--allowed-tools": "variadic",
        "--allowedTools": "variadic",
        "--background": "none",
        "--bg": "none",
        "--continue": "none",
        "--debug": "optional",
        "--exclude-dynamic-system-prompt-sections": "none",
        "--resume": "optional",
        "--version": "none",
        "-c": "none",
        "-d": "optional",
        "-r": "optional",
        "-v": "none",
      },
    });
  });

  test("a wording change leaves the names unchanged", () => {
    const reworded = SAMPLE.replace("Manage background agents", "List and control background agents").replace(
      "Continue the most recent conversation",
      "Resume where you left off",
    );
    expect(parseHelpNames(reworded)).toEqual(parseHelpNames(SAMPLE));
  });

  test("empty input gives empty lists", () => {
    expect(parseHelpNames("")).toEqual({ flags: [], commands: [], flagArity: {} });
  });
});

describe("driftBetween", () => {
  const fixture = { version: "2.1.259", flags: ["--bg", "--model"], commands: ["doctor", "mcp"], flagArity: {} };
  test("no difference means no drift", () => {
    const d = driftBetween(fixture, { ...fixture, version: "2.1.300" });
    expect(hasDrift(d)).toBe(false);
    expect(d.installed).toBe("2.1.300");
  });
  test("added and removed names are listed in the report", () => {
    const d = driftBetween(fixture, {
      version: "2.1.300",
      flags: ["--bg", "--new"],
      commands: ["doctor"],
      flagArity: {},
    });
    expect(hasDrift(d)).toBe(true);
    expect(d.flags).toEqual({ added: ["--new"], removed: ["--model"] });
    expect(d.commands).toEqual({ added: [], removed: ["mcp"] });
    const text = report(d);
    expect(text).toContain("`--new`");
    expect(text).toContain("`--model`");
    expect(text).toContain("`mcp`");
    expect(text).toContain("Installed claude: 2.1.300");
  });
});
