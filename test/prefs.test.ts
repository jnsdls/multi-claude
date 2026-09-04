import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Harness } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

function sharedJson(h: Harness): string {
  return join(h.home, ".claude.json");
}
function accountJson(h: Harness, id: string): any {
  return JSON.parse(readFileSync(join(h.accountDir(id), ".claude.json"), "utf8"));
}

describe("preferences sync", () => {
  test("a theme change in the Shared copy reaches the Account copy at the next launch, Shared untouched", async () => {
    const id = h.plantAccount({ active: true, claudeJson: { theme: "dark" } });
    writeFileSync(sharedJson(h), JSON.stringify({ theme: "light", hasCompletedOnboarding: true, projects: {} }));
    const before = statSync(sharedJson(h));
    const text = readFileSync(sharedJson(h), "utf8");
    await Bun.sleep(20);
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    const copy = accountJson(h, id);
    expect(copy.theme).toBe("light");
    expect(copy.oauthAccount.emailAddress).toBeDefined();
    expect(h.launches()).toHaveLength(1);
    expect(readFileSync(sharedJson(h), "utf8")).toBe(text);
    expect(statSync(sharedJson(h)).mtimeMs).toBe(before.mtimeMs);
    expect(existsSync(join(h.accountDir(id), ".claude.json.lock"))).toBe(false);
  });

  test("an approval given only in the Account copy survives a sync", async () => {
    const id = h.plantAccount({
      active: true,
      claudeJson: { projects: { "/work": { hasTrustDialogAccepted: true, enabledMcpjsonServers: ["mine"] } } },
    });
    writeFileSync(
      sharedJson(h),
      JSON.stringify({ theme: "dark", projects: { "/work": { hasTrustDialogAccepted: false, enabledMcpjsonServers: ["shared"] } } }),
    );
    await h.run(["doctor"]);
    const p = accountJson(h, id).projects["/work"];
    expect(p.hasTrustDialogAccepted).toBe(true);
    expect(p.enabledMcpjsonServers).toEqual(["shared", "mine"]);
  });

  test("a held lock skips the sync silently and the launch goes ahead", async () => {
    const id = h.plantAccount({ active: true, claudeJson: { theme: "dark" } });
    mkdirSync(join(h.accountDir(id), ".claude.json.lock"));
    writeFileSync(sharedJson(h), JSON.stringify({ theme: "light" }));
    const t0 = Date.now();
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(accountJson(h, id).theme).toBe("dark");
    expect(existsSync(join(h.accountDir(id), ".claude.json.lock"))).toBe(true);
  });

  test("a live Run marker in the dir skips the sync", async () => {
    const id = h.plantAccount({ active: true, claudeJson: { theme: "dark" } });
    const runDir = join(h.accountDir(id), ".mclaude", "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, String(process.pid)), "now\n");
    writeFileSync(sharedJson(h), JSON.stringify({ theme: "light" }));
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(accountJson(h, id).theme).toBe("dark");
  });

  test("nothing changed means the Account copy is not rewritten", async () => {
    const id = h.plantAccount({ active: true, claudeJson: { theme: "dark" } });
    writeFileSync(sharedJson(h), JSON.stringify({ theme: "dark" }));
    const path = join(h.accountDir(id), ".claude.json");
    const before = statSync(path).mtimeMs;
    await Bun.sleep(20);
    await h.run(["doctor"]);
    expect(statSync(path).mtimeMs).toBe(before);
  });
});
