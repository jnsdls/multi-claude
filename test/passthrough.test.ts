import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";

const bunDir = dirname(process.execPath);
import { Harness } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

describe("passthrough", () => {
  test("forwards argv in order and unchanged on the Active account", async () => {
    const id = h.plantAccount({ active: true });
    const r = await h.run(["-p", "--model", "opus", "say --hi", "--", "--weird"]);
    expect(r.exitCode).toBe(0);
    const [call] = h.launches();
    // A Session start gains --session-id and --settings ahead of the bare --, so claude reads them as flags.
    expect(call!.argv.slice(0, 4)).toEqual(["-p", "--model", "opus", "say --hi"]);
    expect(call!.argv.slice(-2)).toEqual(["--", "--weird"]);
    expect(call!.argv.slice(4, -2).filter((_, i) => i % 2 === 0)).toEqual(["--session-id", "--settings"]);
    expect(call!.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(id));
    expect(call!.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(h.accountDir(id));
    expect(call!.env.MCLAUDE_ACCOUNT).toBe(id);
  });

  test("bare -- forces passthrough and keeps own flags", async () => {
    h.plantAccount({ active: true });
    const r = await h.run(["--", "account", "list", "--account", "x"]);
    expect(r.exitCode).toBe(0);
    expect(h.launches()[0]!.argv.slice(0, 4)).toEqual(["account", "list", "--account", "x"]);
  });

  test("own flags are stripped wherever they appear before --", async () => {
    h.plantAccount({ active: true });
    const r = await h.run(["--on-exhausted", "fail", "doctor", "--switch-threshold=50", "--", "--on-exhausted", "x"]);
    expect(r.exitCode).toBe(0);
    expect(h.launches()[0]!.argv).toEqual(["doctor", "--", "--on-exhausted", "x"]);
  });

  test("scrubs session markers and keeps host variables", async () => {
    h.plantAccount({ active: true });
    await h.run(["doctor"], {
      env: {
        CLAUDECODE: "1",
        CLAUDE_CODE_CHILD_SESSION: "1",
        CLAUDE_CODE_SESSION_ID: "abc",
        CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
        CLAUDE_AGENT_SDK_VERSION: "1.0",
      },
    });
    const env = h.launches()[0]!.env;
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-ts");
    expect(env.CLAUDE_AGENT_SDK_VERSION).toBe("1.0");
    expect(env.USER).toBeDefined();
  });

  test("mirrors the child's exit code", async () => {
    h.plantAccount({ active: true });
    h.scenario({ default: { exit: 7 } });
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(7);
  });

  test("re-raises the child's signal", async () => {
    h.plantAccount({ active: true });
    h.scenario({ default: { exitSignal: "SIGTERM" } });
    const r = await h.run(["doctor"]);
    expect(r.signal).toBe("SIGTERM");
  });

  test("forwards SIGTERM to the child", async () => {
    h.plantAccount({ active: true });
    h.scenario({ default: { sleepMs: 10_000 } });
    const p = h.spawn(["doctor"]);
    await h.waitFor(() => h.launches().length === 1);
    p.kill("SIGTERM");
    await p.exited;
    expect(p.signalCode).toBe("SIGTERM");
  });

  test("zero Accounts exits 1 with a pointer at account add", async () => {
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("account add");
    expect(h.launches().length).toBe(0);
  });

  test("a dangling active pointer counts as no Active account", async () => {
    h.plantAccount({});
    h.setActive("nope1234");
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(1);
  });

  test("auth login and logout are refused, auth status forwards", async () => {
    h.plantAccount({ active: true });
    const login = await h.run(["auth", "login"]);
    expect(login.exitCode).toBe(64);
    expect(login.stderr).toContain("account add");
    const logout = await h.run(["auth", "logout"]);
    expect(logout.exitCode).toBe(64);
    expect(logout.stderr).toContain("account remove");
    const status = await h.run(["auth", "status"]);
    expect(status.exitCode).toBe(0);
    expect(h.calls().some((c) => c.kind === "auth status")).toBe(true);
  });

  test("--version prints claude's string on stdout and mclaude's on stderr", async () => {
    const r = await h.run(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("2.1.259 (Claude Code)\n");
    expect(r.stderr).toMatch(/^mclaude \S+\n$/);
  });

  test("--version works with no Account", async () => {
    const r = await h.run(["-v"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("2.1.259 (Claude Code)\n");
  });

  test("version command prints the drift constants", async () => {
    const r = await h.run(["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("mclaude ");
    expect(r.stdout).toContain("claude 2.1.259 (Claude Code)");
    expect(r.stdout).toContain(`claude path ${h.fakeClaude}`);
    expect(r.stdout).toContain("bun ");
    expect(r.stdout).toContain("checked version 2.1.259");
    expect(r.stdout).toContain("version floor 2.1.223");
    expect(r.stdout).not.toContain("newer than checked");
  });

  test("version marks a claude newer than checked and never opens config.json", async () => {
    h.scenario({ version: "2.2.0 (Claude Code)" });
    h.writeConfig("{ not json");
    const r = await h.run(["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("newer than checked");
  });

  test("--help forwards and adds the footer on stderr", async () => {
    h.plantAccount({ active: true });
    const r = await h.run(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage: claude");
    expect(r.stderr.trim().split("\n").length).toBe(3);
    expect(r.stderr).toContain("account, version, hook");
  });

  test("a Session start below the version floor exits 69 naming both versions", async () => {
    h.plantAccount({ active: true });
    h.scenario({ version: "2.1.200 (Claude Code)" });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(69);
    expect(r.stderr).toContain("2.1.200");
    expect(r.stderr).toContain("2.1.223");
    expect(h.launches().length).toBe(0);
    const plain = await h.run(["doctor"]);
    expect(plain.exitCode).toBe(0);
  });

  test("a Session start at the floor exactly proceeds", async () => {
    h.plantAccount({ active: true });
    h.scenario({ version: "2.1.223 (Claude Code)" });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(h.launches().length).toBe(1);
  });

  test("unparseable version output proceeds", async () => {
    h.plantAccount({ active: true });
    h.scenario({ version: "garbage" });
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(0);
  });

  test("--bare on a Session start warns that Handoff is off", async () => {
    h.plantAccount({ active: true });
    const r = await h.run(["--bare", "-p", "hi"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("Handoff is off");
  });

  test("symlink farm links Shared home entries and skips private ones", async () => {
    const id = h.plantAccount({ active: true });
    mkdirSync(join(h.sharedHome, "skills"), { recursive: true });
    writeFileSync(join(h.sharedHome, "history.jsonl"), "");
    writeFileSync(join(h.sharedHome, "stats-cache.json"), "{}");
    await h.run(["doctor"]);
    const dir = h.accountDir(id);
    expect(lstatSync(join(dir, "skills")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "projects")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "history.jsonl")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, "stats-cache.json"))).toBe(false);
    expect(lstatSync(join(dir, ".claude.json")).isSymbolicLink()).toBe(false);
  });

  test("symlink farm replaces an empty real dir with the link and leaves a non-empty dir or a file, naming each", async () => {
    const id = h.plantAccount({ active: true });
    const dir = h.accountDir(id);
    mkdirSync(join(h.sharedHome, "skills"), { recursive: true });
    mkdirSync(join(h.sharedHome, "todos"), { recursive: true });
    writeFileSync(join(h.sharedHome, "history.jsonl"), "");
    mkdirSync(join(dir, "skills"));
    mkdirSync(join(dir, "todos"));
    writeFileSync(join(dir, "todos", "one.json"), "{}");
    writeFileSync(join(dir, "history.jsonl"), "mine\n");
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(lstatSync(join(dir, "skills")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "todos")).isDirectory()).toBe(true);
    expect(existsSync(join(dir, "todos", "one.json"))).toBe(true);
    expect(lstatSync(join(dir, "history.jsonl")).isFile()).toBe(true);
    const lines = r.stderr.trim().split("\n").sort();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(join(dir, "history.jsonl"));
    expect(lines[0]).toContain("merge it by hand");
    expect(lines[1]).toContain(join(dir, "todos"));
  });

  test("writes a Run marker while the child runs and removes it after", async () => {
    const id = h.plantAccount({ active: true });
    h.scenario({ default: { sleepMs: 5000 } });
    const p = h.spawn(["doctor"]);
    const runDir = join(h.accountDir(id), ".mclaude", "run");
    await h.waitFor(() => existsSync(join(runDir, String(p.pid))));
    expect(existsSync(join(runDir, String(p.pid)))).toBe(true);
    p.kill("SIGTERM");
    await p.exited;
    expect(existsSync(join(runDir, String(p.pid)))).toBe(false);
  });
});

describe("claude resolution", () => {
  test("MCLAUDE_CLAUDE_PATH missing exits 69", async () => {
    h.plantAccount({ active: true });
    const r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: "/nonexistent/claude" } });
    expect(r.exitCode).toBe(69);
  });
  test("config claudePath beats PATH and a bad one exits 78", async () => {
    h.plantAccount({ active: true });
    const bin = join(h.root, "pathbin");
    mkdirSync(bin);
    symlinkSync(h.fakeClaude, join(bin, "claude"));
    h.writeConfig(`{"claudePath": "/nonexistent/claude"}`);
    const r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: undefined, PATH: `${bin}:${bunDir}` } });
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("claudePath");
  });
  test("PATH, then ~/.local/bin/claude, else 69", async () => {
    h.plantAccount({ active: true });
    const bin = join(h.root, "pathbin");
    mkdirSync(bin);
    symlinkSync(h.fakeClaude, join(bin, "claude"));
    let r = await h.run(["doctor"], {
      env: { MCLAUDE_CLAUDE_PATH: undefined, PATH: `${bin}:${bunDir}:/usr/bin:/bin` },
    });
    expect(r.exitCode).toBe(0);
    const local = join(h.home, ".local", "bin");
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, "claude"), `#!/bin/sh\nexec "${h.fakeClaude}" "$@"\n`);
    chmodSync(join(local, "claude"), 0o755);
    r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: undefined, PATH: `${bunDir}:/usr/bin:/bin` } });
    expect(r.exitCode).toBe(0);
    r = await h.run(["doctor"], {
      env: { MCLAUDE_CLAUDE_PATH: undefined, PATH: `${bunDir}:/usr/bin:/bin`, HOME: join(h.root, "nohome") },
    });
    expect(r.exitCode).toBe(69);
  });
  test("MCLAUDE_HOME is honoured as a literal path", async () => {
    const other = join(h.root, "elsewhere");
    mkdirSync(other, { recursive: true });
    const r = await h.run(["doctor"], { env: { MCLAUDE_HOME: other } });
    expect(r.exitCode).toBe(1);
  });
});

describe("config.json on a passthrough", () => {
  test("unparseable exits 78; unknown key warns", async () => {
    h.plantAccount({ active: true });
    h.writeConfig("{ nope");
    expect((await h.run(["doctor"])).exitCode).toBe(78);
    h.writeConfig(`{ "swichThreshold": 50, // typo\n }`);
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("swichThreshold");
  });
});
