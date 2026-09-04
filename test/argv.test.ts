import { describe, expect, test } from "bun:test";
import { classify, classifyMode, removeValueFlag, scanArgv, stripOwnFlags } from "../src/argv.ts";

describe("classifyMode", () => {
  test("reserved words", () => {
    expect(classifyMode(["account", "list"])).toEqual({ kind: "account", args: ["list"] });
    expect(classifyMode(["version"])).toEqual({ kind: "version" });
    expect(classifyMode(["hook"])).toEqual({ kind: "hook" });
  });
  test("bare -- forces passthrough of the rest", () => {
    expect(classifyMode(["--", "account", "list"])).toEqual({ kind: "passthrough", argv: ["account", "list"], forced: true });
  });
  test("anything else is passthrough, no list of claude commands", () => {
    expect(classifyMode(["foo", "bar"])).toEqual({ kind: "passthrough", argv: ["foo", "bar"], forced: false });
    expect(classifyMode([])).toEqual({ kind: "passthrough", argv: [], forced: false });
  });
});

describe("stripOwnFlags", () => {
  const cases: [string[], Record<string, string>, string[]][] = [
    [["--on-exhausted", "fail", "-p", "hi"], { onExhausted: "fail" }, ["-p", "hi"]],
    [["-p", "--switch-threshold=80", "hi"], { switchThreshold: "80" }, ["-p", "hi"]],
    [["--model", "opus", "--account", "work"], { account: "work" }, ["--model", "opus"]],
    [["--account=work", "--", "--account", "x"], { account: "work" }, ["--", "--account", "x"]],
    [["-p", "--", "--on-exhausted", "fail"], {}, ["-p", "--", "--on-exhausted", "fail"]],
    [["a", "--account", "w", "b", "--switch-threshold", "5", "c"], { account: "w", switchThreshold: "5" }, ["a", "b", "c"]],
  ];
  for (const [argv, own, forwarded] of cases) {
    test(argv.join(" "), () => {
      const r = stripOwnFlags(argv);
      expect(r.own).toEqual(own);
      expect(r.forwarded).toEqual(forwarded);
      expect(r.errors).toEqual([]);
    });
  }
  test("missing value is an error", () => {
    expect(stripOwnFlags(["-p", "--account"]).errors.length).toBe(1);
  });
});

describe("scanArgv", () => {
  test("value flags in both forms", () => {
    const s = scanArgv(["--model", "opus", "--output-format=stream-json", "--settings", "/x.json"]);
    expect(s.model).toBe("opus");
    expect(s.outputFormat).toBe("stream-json");
    expect(s.settings).toBe("/x.json");
    expect(s.positionals).toEqual([]);
  });
  test("bool flags and short forms", () => {
    const s = scanArgv(["-p", "-c", "--fork-session", "--bg", "--bare", "--safe-mode"]);
    expect(s.print).toBe(true);
    expect(s.continue).toBe(true);
    expect(s.forkSession).toBe(true);
    expect(s.bg).toBe(true);
    expect(s.bare).toBe(true);
    expect(s.safeMode).toBe(true);
  });
  test("resume with and without a value", () => {
    expect(scanArgv(["--resume"]).resume).toBe(true);
    expect(scanArgv(["-r", "abc"]).resume).toBe("abc");
    expect(scanArgv(["--resume=abc"]).resume).toBe("abc");
    expect(scanArgv(["--resume", "--model", "x"]).resume).toBe(true);
  });
  test("steps over unknown flags, no clustering", () => {
    const s = scanArgv(["--permission-mode", "plan", "-dp", "hello"]);
    expect(s.print).toBe(false);
    expect(s.positionals).toEqual(["plan", "hello"]);
  });
  test("everything after -- is positional", () => {
    const s = scanArgv(["-p", "--", "--model", "x"]);
    expect(s.model).toBeUndefined();
    expect(s.positionals).toEqual(["--model", "x"]);
  });
  test("version and help", () => {
    expect(scanArgv(["--version"]).version).toBe(true);
    expect(scanArgv(["-v"]).version).toBe(true);
    expect(scanArgv(["-h"]).help).toBe(true);
    expect(scanArgv(["mcp", "--help"]).help).toBe(true);
  });
});

describe("classify", () => {
  const sessionStarts = [[], ["hello there"], ["-p", "hi"], ["--resume"], ["--resume", "abc"], ["-c"], ["--bg"], ["--model", "opus"]];
  for (const argv of sessionStarts) {
    test(`session start: ${argv.join(" ") || "(tui)"}`, () => expect(classify(scanArgv(argv))).toBe("session-start"));
  }
  const plain = [["doctor"], ["mcp", "list"], ["plugin", "install", "x"], ["update"], ["attach", "abc"], ["logs", "abc"], ["auth", "status"], ["--model", "opus", "doctor"]];
  for (const argv of plain) {
    test(`passthrough: ${argv.join(" ")}`, () => expect(classify(scanArgv(argv))).toBe("passthrough"));
  }
  test("version, help, auth refused", () => {
    expect(classify(scanArgv(["--version"]))).toBe("version");
    expect(classify(scanArgv(["--help"]))).toBe("help");
    expect(classify(scanArgv(["auth", "login"]))).toBe("auth-refused");
    expect(classify(scanArgv(["auth", "logout"]))).toBe("auth-refused");
  });
});

describe("removeValueFlag", () => {
  test("removes both forms before --", () => {
    expect(removeValueFlag(["--settings", "a", "-p", "--settings=b", "--", "--settings", "c"], "--settings")).toEqual([
      "-p",
      "--",
      "--settings",
      "c",
    ]);
  });
});
