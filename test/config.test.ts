import { describe, expect, test } from "bun:test";
import { parseConfig, resolveSettings } from "../src/config.ts";
import { ExitError } from "../src/exit.ts";

function code(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ExitError ? e.code : -1;
  }
}

describe("parseConfig", () => {
  test("JSONC with comments and trailing commas", () => {
    const warns: string[] = [];
    const c = parseConfig(`{ // comment\n "onExhausted": "fail", "switchThreshold": 80, "claudePath": "~/bin/claude", "version": 1, }`, (l) => warns.push(l));
    expect(c).toEqual({ onExhausted: "fail", switchThreshold: 80, claudePath: "~/bin/claude" });
    expect(warns).toEqual([]);
  });
  test("unknown key warns and is ignored", () => {
    const warns: string[] = [];
    expect(parseConfig(`{"switchTreshold": 50}`, (l) => warns.push(l))).toEqual({});
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("switchTreshold");
  });
  test("invalid values exit 78", () => {
    expect(code(() => parseConfig("{"))).toBe(78);
    expect(code(() => parseConfig(`[]`))).toBe(78);
    expect(code(() => parseConfig(`{"onExhausted": "sleep"}`))).toBe(78);
    expect(code(() => parseConfig(`{"switchThreshold": 101}`))).toBe(78);
    expect(code(() => parseConfig(`{"switchThreshold": "90"}`))).toBe(78);
    expect(code(() => parseConfig(`{"version": 2}`))).toBe(78);
    expect(code(() => parseConfig(`{"claudePath": "claude"}`))).toBe(78);
    expect(code(() => parseConfig(`{"claudePath": "./claude"}`))).toBe(78);
  });
});

describe("resolveSettings", () => {
  test("flag over env over file over default", () => {
    expect(resolveSettings({}, {}, {}).switchThreshold).toBe(90);
    expect(resolveSettings({}, { switchThreshold: 70 }, {}).switchThreshold).toBe(70);
    expect(resolveSettings({}, { switchThreshold: 70 }, { MCLAUDE_SWITCH_THRESHOLD: "60" }).switchThreshold).toBe(60);
    expect(resolveSettings({ switchThreshold: "50" }, { switchThreshold: 70 }, { MCLAUDE_SWITCH_THRESHOLD: "60" }).switchThreshold).toBe(50);
    expect(resolveSettings({}, {}, {}).onExhausted).toBe("launch");
    expect(resolveSettings({}, { onExhausted: "fail" }, {}).onExhausted).toBe("fail");
    expect(resolveSettings({}, { onExhausted: "fail" }, { MCLAUDE_ON_EXHAUSTED: "launch" }).onExhausted).toBe("launch");
    expect(resolveSettings({ onExhausted: "fail" }, {}, { MCLAUDE_ON_EXHAUSTED: "launch" }).onExhausted).toBe("fail");
  });
  test("claudePath env beats file", () => {
    expect(resolveSettings({}, { claudePath: "/a" }, { MCLAUDE_CLAUDE_PATH: "/b" }).claudePath).toEqual({ value: "/b", source: "env" });
    expect(resolveSettings({}, { claudePath: "/a" }, {}).claudePath).toEqual({ value: "/a", source: "config" });
  });
  test("bad flag values are usage errors", () => {
    expect(code(() => resolveSettings({ onExhausted: "x" }, {}, {}))).toBe(64);
    expect(code(() => resolveSettings({ switchThreshold: "abc" }, {}, {}))).toBe(64);
    expect(code(() => resolveSettings({}, {}, { MCLAUDE_SWITCH_THRESHOLD: "200" }))).toBe(64);
  });
});
