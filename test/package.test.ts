import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { platformPackage, TARGETS } from "../scripts/platforms.ts";
import { MAIN_PACKAGE, mainManifest, platformManifest, readRootManifest } from "../scripts/stage.ts";

const pkg = readRootManifest(join(import.meta.dir, ".."));

describe("the npm packages", () => {
  test("the repo's package.json is private and lists no platform packages", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.optionalDependencies).toBeUndefined();
  });
  test("the main manifest pins the four platform packages at this version", () => {
    const m = mainManifest(pkg);
    expect(m.name).toBe(MAIN_PACKAGE);
    expect(m.bin).toEqual({ mclaude: "bin/mclaude" });
    expect(m.optionalDependencies).toEqual(
      Object.fromEntries(TARGETS.map((t) => [platformPackage(t), pkg.version])),
    );
  });
  test("a platform manifest is restricted to its os and cpu", () => {
    const m = platformManifest(pkg, "linux-arm64");
    expect(m.name).toBe("multi-claude-linux-arm64");
    expect(m.os).toEqual(["linux"]);
    expect(m.cpu).toEqual(["arm64"]);
    expect(m.version).toBe(pkg.version);
  });
});
