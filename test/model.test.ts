import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelFromSettingsFile, normalizeModel, resolveRequestedModel } from "../src/model.ts";

let root: string;
let cwd: string;
let home: string;
const savedHome = process.env.HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mclaude-model-"));
  cwd = join(root, "project");
  home = join(root, "home");
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(root, { recursive: true, force: true });
});

function settings(path: string, body: unknown): void {
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
}

describe("resolveRequestedModel", () => {
  test("--model wins over everything", () => {
    settings(join(cwd, ".claude", "settings.local.json"), { model: "haiku" });
    expect(resolveRequestedModel({ model: "claude-opus-4-1" }, { ANTHROPIC_MODEL: "sonnet" }, cwd)).toBe("claude-opus-4-1");
  });

  test("ANTHROPIC_MODEL over the settings files", () => {
    settings(join(cwd, ".claude", "settings.local.json"), { model: "haiku" });
    expect(resolveRequestedModel({}, { ANTHROPIC_MODEL: "sonnet" }, cwd)).toBe("sonnet");
  });

  test("settings.local.json over settings.json over the Shared home", () => {
    settings(join(home, ".claude", "settings.json"), { model: "shared" });
    expect(resolveRequestedModel({}, {}, cwd)).toBe("shared");
    settings(join(cwd, ".claude", "settings.json"), { model: "project" });
    expect(resolveRequestedModel({}, {}, cwd)).toBe("project");
    settings(join(cwd, ".claude", "settings.local.json"), { model: "local" });
    expect(resolveRequestedModel({}, {}, cwd)).toBe("local");
  });

  test("opusplan means opus wherever it comes from", () => {
    expect(resolveRequestedModel({ model: "opusplan" }, {}, cwd)).toBe("opus");
    expect(resolveRequestedModel({}, { ANTHROPIC_MODEL: "OpusPlan" }, cwd)).toBe("opus");
    settings(join(cwd, ".claude", "settings.json"), { model: "opusplan" });
    expect(resolveRequestedModel({}, {}, cwd)).toBe("opus");
    expect(normalizeModel("claude-opus-4-1")).toBe("claude-opus-4-1");
  });

  test("--fallback-model is ignored", () => {
    expect(resolveRequestedModel({ fallbackModel: "haiku" } as { model?: string }, {}, cwd)).toBeNull();
  });

  test("unresolvable is null", () => {
    expect(resolveRequestedModel({}, {}, cwd)).toBeNull();
    expect(resolveRequestedModel({}, { ANTHROPIC_MODEL: "" }, cwd)).toBeNull();
  });

  test("an unreadable or modelless settings file is skipped, not fatal", () => {
    settings(join(cwd, ".claude", "settings.local.json"), "{ not json");
    settings(join(cwd, ".claude", "settings.json"), { model: 42 });
    settings(join(home, ".claude", "settings.json"), { model: "  " });
    expect(resolveRequestedModel({}, {}, cwd)).toBeNull();
    settings(join(home, ".claude", "settings.json"), { model: "sonnet" });
    expect(resolveRequestedModel({}, {}, cwd)).toBe("sonnet");
  });

  test("modelFromSettingsFile on a missing file is null", () => {
    expect(modelFromSettingsFile(join(root, "nope.json"))).toBeNull();
  });
});
