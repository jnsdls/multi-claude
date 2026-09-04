import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { platformPackage, TARGETS } from "../scripts/platforms.ts";

const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json();

describe("package.json", () => {
  test("optionalDependencies are the four platform packages at this version", () => {
    expect(pkg.optionalDependencies).toEqual(
      Object.fromEntries(TARGETS.map((t) => [platformPackage(t), pkg.version])),
    );
  });
  test("the npm package ships the launcher, not dist", () => {
    expect(pkg.files).toEqual(["bin", "README.md", "LICENSE"]);
  });
});
