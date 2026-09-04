import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { Harness, usageBody } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

/** Inside the five-minute margin. */
const SOON = () => Date.now() + 60_000;

function lastCell(stdout: string, line = 1): string {
  return stdout
    .split("\n")
    [line]!.trim()
    .split(/\s{2,}/)
    .at(-1)!;
}

describe("the Refresh trigger on list --refresh", () => {
  test("runs claude -p in the Account dir with the recipe, then polls with the new token", async () => {
    const id = h.plantAccount({ alias: "a", expiresAt: SOON() });
    h.scenario({ refresh: "advance" });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 33 }) } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);

    const calls = h.calls();
    expect(calls.map((c) => c.kind)).toEqual(["refresh"]);
    const trigger = calls[0]!;
    expect(trigger.argv).toEqual([
      "-p",
      "hi",
      "--max-turns",
      "1",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ]);
    expect(trigger.cwd).toBe(realpathSync(h.accountDir(id)));
    expect(trigger.env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(trigger.env.CLAUDE_CODE_MAX_RETRIES).toBe("0");
    expect(trigger.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(id));
    expect(trigger.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(h.accountDir(id));
    expect(trigger.env.MCLAUDE_ACCOUNT).toBe(id);
    expect(trigger.env.MCLAUDE_USAGE_URL).toBeUndefined();
    expect(trigger.stdinLines).toEqual([]);
    expect(readdirSync(join(h.sharedHome, "projects"))).toEqual([]);

    // The usage request came after the trigger and carried the rotated token.
    expect(usage.requests).toHaveLength(1);
    expect(usage.requests[0]!.token).toMatch(/^sk-ant-oat01-refreshed-/);
    expect(usage.requests[0]!.at).toBeGreaterThanOrEqual(trigger.startedAt as number);
    expect(lastCell(r.stdout)).toBe("ok");
    expect(r.stdout).toContain("33% ↻");
  });

  test("with no claude to run it, a due trigger is skipped with one line and the poll goes on", async () => {
    h.plantAccount({ alias: "a", expiresAt: SOON() });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 33 }) } });
    const r = await h.run(["account", "list", "--refresh"], {
      env: { MCLAUDE_CLAUDE_PATH: undefined, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    });
    expect(r.exitCode).toBe(0);
    expect(h.calls()).toHaveLength(0);
    expect(usage.requests).toHaveLength(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("Refresh trigger was skipped for a");
    expect(lastCell(r.stdout)).toBe("ok");
  });

  test("a zeroed credential shows needs login and no usage request is made", async () => {
    h.plantAccount({ alias: "a", expiresAt: SOON() });
    h.scenario({ refresh: "zero" });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    expect(h.calls().map((c) => c.kind)).toEqual(["refresh"]);
    expect(usage.requests).toHaveLength(0);
    expect(lastCell(r.stdout)).toBe("needs login");
    expect(r.stderr).toContain("account login a");
  });

  test("an unchanged credential is Unknown for the attempt; the poll still runs on the old token", async () => {
    const id = h.plantAccount({ alias: "a", expiresAt: SOON() });
    h.scenario({ refresh: "unchanged" });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(h.calls().map((c) => c.kind)).toEqual(["refresh"]);
    expect(usage.requests.map((q) => q.token)).toEqual([`sk-ant-oat01-${id}`]);
    expect(lastCell(r.stdout)).toBe("ok");
  });

  test("outside the margin nothing runs", async () => {
    h.plantAccount({ alias: "a", expiresAt: Date.now() + 301_000 });
    h.scenario({ refresh: "advance" });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["account", "list", "--refresh"]);
    expect(h.calls()).toHaveLength(0);
    expect(usage.requests).toHaveLength(1);
  });

  test("a Needs login Account and a fresh Reading get no trigger", async () => {
    h.plantAccount({ alias: "dead", expiresAt: 0 });
    h.plantAccount({ alias: "fresh", expiresAt: SOON(), usage: { fetchedAt: new Date().toISOString() } });
    h.scenario({ refresh: "advance" });
    await h.startUsage({ default: { body: usageBody() } });
    await h.run(["account", "list", "--refresh"]);
    expect(h.calls()).toHaveLength(0);
  });

  test("resolves claude from the environment; config.json is never opened", async () => {
    h.plantAccount({ alias: "a", expiresAt: SOON() });
    h.writeConfig("not json");
    h.scenario({ refresh: "advance" });
    await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    expect(h.calls().map((c) => c.kind)).toEqual(["refresh"]);
  });

  test("list without --refresh never triggers", async () => {
    h.plantAccount({ alias: "a", expiresAt: SOON() });
    h.scenario({ refresh: "advance" });
    await h.run(["account", "list"]);
    expect(h.calls()).toHaveLength(0);
  });
});

describe("the Refresh trigger on add", () => {
  test("runs before the first poll when the fresh login is already inside the margin", async () => {
    h.scenario({
      refresh: "advance",
      login: {
        credential: {
          claudeAiOauth: {
            accessToken: "sk-ant-oat01-fake",
            refreshToken: "sk-ant-ort01-fake",
            expiresAt: SOON(),
            scopes: ["user:inference", "user:profile"],
            subscriptionType: "max",
          },
        },
      },
    });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(0);
    expect(h.calls().map((c) => c.kind)).toEqual(["auth login", "auth status", "refresh"]);
    expect(usage.requests).toHaveLength(1);
    expect(usage.requests[0]!.token).toMatch(/^sk-ant-oat01-refreshed-/);
  });
});
