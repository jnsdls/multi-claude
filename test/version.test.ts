import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKED_VERSION, compareVersions, parseVersion, VERSION_FLOOR } from "../src/version.ts";

describe("parseVersion", () => {
  const cases: [string, [number, number, number] | null][] = [
    ["2.1.259 (Claude Code)", [2, 1, 259]],
    ["2.1.259", [2, 1, 259]],
    ["  10.0.1\n", [10, 0, 1]],
    ["claude 2.1.223 something", [2, 1, 223]],
    ["garbage", null],
    ["2.1", null],
    ["", null],
  ];
  for (const [input, want] of cases) {
    test(JSON.stringify(input), () => {
      expect(parseVersion(input)).toEqual(want);
    });
  }
});

describe("compareVersions", () => {
  const cases: [[number, number, number], [number, number, number], number][] = [
    [[2, 1, 223], [2, 1, 223], 0],
    [[2, 1, 222], [2, 1, 223], -1],
    [[2, 1, 224], [2, 1, 223], 1],
    [[2, 2, 0], [2, 1, 999], 1],
    [[3, 0, 0], [2, 99, 99], 1],
    [[1, 99, 99], [2, 0, 0], -1],
  ];
  for (const [a, b, want] of cases) {
    test(`${a.join(".")} vs ${b.join(".")}`, () => {
      expect(compareVersions(a, b)).toBe(want);
    });
  }
});

describe("constants", () => {
  test("the floor is at or below the Checked version", () => {
    expect(compareVersions(parseVersion(VERSION_FLOOR)!, parseVersion(CHECKED_VERSION)!)).toBeLessThanOrEqual(0);
  });
  test("the fixture and the Checked version move together", async () => {
    const fixture = await Bun.file(join(import.meta.dir, "..", "fixtures", "claude-help.json")).json();
    expect(fixture.version).toBe(CHECKED_VERSION);
    expect(fixture.flags).toContain("--model");
    expect(fixture.commands).toContain("doctor");
  });
});
