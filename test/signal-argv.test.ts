// The argv a Session start hands claude, and the settings merge: pure, table-tested.
import { describe, expect, test } from "bun:test";
import { scanArgv } from "../src/argv.ts";
import { hookSettings, injectSessionArgv, sessionIdFor } from "../src/signal.ts";

const SETTINGS = "/home/u/.mclaude/limits/s1/settings.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("injectSessionArgv", () => {
  const cases: [name: string, argv: string[], unparseable: boolean, expected: string[], warns: boolean][] = [
    ["a bare TUI start gets both flags last", [], false, ["--session-id", "s1", "--settings", SETTINGS], false],
    [
      "a prompt keeps its order",
      ["-p", "hi", "--model", "opus"],
      false,
      ["-p", "hi", "--model", "opus", "--session-id", "s1", "--settings", SETTINGS],
      false,
    ],
    [
      "--session-id from the user is kept and none is added",
      ["--session-id", "u1"],
      false,
      ["--session-id", "u1", "--settings", SETTINGS],
      false,
    ],
    ["--session-id=value form", ["--session-id=u1"], false, ["--session-id=u1", "--settings", SETTINGS], false],
    ["--resume <id> adds no session id", ["--resume", "u1"], false, ["--resume", "u1", "--settings", SETTINGS], false],
    ["--resume with no value adds no session id", ["--resume"], false, ["--resume", "--settings", SETTINGS], false],
    ["-r short form", ["-r", "u1"], false, ["-r", "u1", "--settings", SETTINGS], false],
    ["--continue adds no session id", ["--continue"], false, ["--continue", "--settings", SETTINGS], false],
    ["-c short form", ["-c"], false, ["-c", "--settings", SETTINGS], false],
    [
      "a user --settings path is replaced by the merged file",
      ["--settings", "my.json", "-p", "hi"],
      false,
      ["-p", "hi", "--session-id", "s1", "--settings", SETTINGS],
      false,
    ],
    [
      "a user --settings=inline is replaced too",
      ['--settings={"a":1}'],
      false,
      ["--session-id", "s1", "--settings", SETTINGS],
      false,
    ],
    [
      "every user --settings goes",
      ["--settings", "a.json", "--settings=b.json"],
      false,
      ["--session-id", "s1", "--settings", SETTINGS],
      false,
    ],
    [
      "an unparseable user --settings is forwarded untouched and nothing is added for settings",
      ["--settings", "nope.json", "-p", "hi"],
      true,
      ["--settings", "nope.json", "-p", "hi", "--session-id", "s1"],
      true,
    ],
    [
      "the flags land ahead of a bare --",
      ["-p", "--", "--weird"],
      false,
      ["-p", "--session-id", "s1", "--settings", SETTINGS, "--", "--weird"],
      false,
    ],
    [
      "a --settings after a bare -- is a positional and stays",
      ["--", "--settings", "x"],
      false,
      ["--session-id", "s1", "--settings", SETTINGS, "--", "--settings", "x"],
      false,
    ],
  ];
  for (const [name, argv, unparseable, expected, warns] of cases) {
    test(name, () => {
      const r = injectSessionArgv(argv, scanArgv(argv), "s1", SETTINGS, unparseable);
      expect(r.argv).toEqual(expected);
      expect(r.warning !== null).toBe(warns);
      if (r.warning) expect(r.warning).toContain("Limit detection is off");
    });
  }
});

describe("sessionIdFor", () => {
  test("a fresh uuid by default", () => {
    expect(sessionIdFor(scanArgv([]))).toMatch(UUID);
  });
  test("the user's --session-id", () => {
    expect(sessionIdFor(scanArgv(["--session-id", "abc-123"]))).toBe("abc-123");
  });
  test("the user's --resume <id>", () => {
    expect(sessionIdFor(scanArgv(["--resume", "abc-123"]))).toBe("abc-123");
  });
  test("--resume with no value and --continue get a uuid that only names the dir", () => {
    expect(sessionIdFor(scanArgv(["--resume"]))).toMatch(UUID);
    expect(sessionIdFor(scanArgv(["-c"]))).toMatch(UUID);
  });
  test("a value that cannot name a directory gets a uuid", () => {
    expect(sessionIdFor(scanArgv(["--resume", "../x"]))).toMatch(UUID);
    expect(sessionIdFor(scanArgv(["--session-id", "a/b"]))).toMatch(UUID);
  });
});

describe("hookSettings", () => {
  const cmd = "'/opt/mclaude' hook";
  test("no user settings: exactly the two entries", () => {
    expect(hookSettings(null, cmd)).toEqual({
      hooks: {
        StopFailure: [{ matcher: "rate_limit", hooks: [{ type: "command", command: cmd }] }],
        SessionStart: [{ hooks: [{ type: "command", command: cmd }] }],
      },
    });
  });
  test("user hooks stay ahead, other keys stay, the input is not mutated", () => {
    const mine = { type: "command", command: "echo hi" };
    const user = {
      model: "opus",
      hooks: { StopFailure: [{ matcher: ".*", hooks: [mine] }], PreToolUse: [{ hooks: [mine] }] },
    };
    const before = JSON.stringify(user);
    const out = hookSettings(user, cmd) as any;
    expect(JSON.stringify(user)).toBe(before);
    expect(out.model).toBe("opus");
    expect(out.hooks.PreToolUse).toEqual([{ hooks: [mine] }]);
    expect(out.hooks.StopFailure).toHaveLength(2);
    expect(out.hooks.StopFailure[0]).toEqual({ matcher: ".*", hooks: [mine] });
    expect(out.hooks.StopFailure[1].matcher).toBe("rate_limit");
    expect(out.hooks.SessionStart).toHaveLength(1);
    expect(out.hooks.PostToolUseFailure).toBeUndefined();
  });
  test("a hooks key that is not an object is replaced", () => {
    const out = hookSettings({ hooks: "junk" }, cmd) as any;
    expect(Object.keys(out.hooks).sort()).toEqual(["SessionStart", "StopFailure"]);
  });
});
