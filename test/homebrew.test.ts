import { describe, expect, test } from "bun:test";
import { TARGETS } from "../scripts/platforms.ts";
import { formula, parseShasums } from "../scripts/homebrew.ts";

const sums = parseShasums(
  TARGETS.map((t, i) => `${String(i + 1).repeat(64)}  mclaude-${t}.tar.gz`).join("\n") + "\n",
);

describe("the Homebrew formula", () => {
  test("parseShasums reads shasum's format", () => {
    expect(sums.size).toBe(4);
    expect(sums.get("mclaude-linux-x64.tar.gz")).toBe("3".repeat(64));
    expect(parseShasums("abc  x.tar.gz\n").size).toBe(0);
  });
  test("every target gets its own tarball and sha256", () => {
    const rb = formula("0.1.2", sums);
    // Homebrew reads the version from the url; an explicit one fails `brew audit`.
    expect(rb).not.toContain("version \"");
    for (const [i, t] of TARGETS.entries()) {
      expect(rb).toContain(`/releases/download/v0.1.2/mclaude-${t}.tar.gz`);
      expect(rb).toContain(`sha256 "${String(i + 1).repeat(64)}"`);
    }
    expect(rb).toContain('assert_match "mclaude #{version}"');
  });
  test("a missing tarball or a non-release version is refused", () => {
    const short = new Map(sums);
    short.delete("mclaude-darwin-x64.tar.gz");
    expect(() => formula("0.1.2", short)).toThrow("mclaude-darwin-x64.tar.gz");
    expect(() => formula("v0.1.2", sums)).toThrow("not a release version");
  });
});
