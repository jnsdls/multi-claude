// config.json at the process seam (ADR 0005): what the table tests in
// test/config.test.ts cannot see. Which invocations open the file, what a bad
// file does to a launch, and where claude is resolved from.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Harness } from "./harness/harness.ts";

const bunDir = dirname(process.execPath);

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

/** A claude that marks the child's environment with `which`, then runs the fake. */
function markedClaude(dir: string, which: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "claude");
  writeFileSync(p, `#!/bin/sh\nexport WHICH_CLAUDE=${which}\nexec "${h.fakeClaude}" "$@"\n`);
  chmodSync(p, 0o755);
  return p;
}

describe("config.json on a Passthrough", () => {
  test("an unknown key warns once and the launch continues", async () => {
    h.plantAccount({ active: true });
    h.writeConfig(`{ "swtichThreshold": 50, "switchThreshold": 60 }`);
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.split("\n").filter((l) => l.includes("swtichThreshold")).length).toBe(1);
    expect(h.launches().length).toBe(1);
  });

  const invalid: [string, string][] = [
    [`{ "onExhausted": "sleep" }`, "onExhausted"],
    [`{ "switchThreshold": 101 }`, "switchThreshold"],
    [`{ "switchThreshold": "90" }`, "switchThreshold"],
    [`{ "version": 2 }`, "version"],
    [`{ "claudePath": "claude" }`, "claudePath"],
    [`{ "claudePath": "./claude" }`, "claudePath"],
  ];
  for (const [text, key] of invalid) {
    test(`${text} exits 78 naming ${key}`, async () => {
      h.plantAccount({ active: true });
      h.writeConfig(text);
      const r = await h.run(["doctor"]);
      expect(r.exitCode).toBe(78);
      expect(r.stderr).toContain(key);
      expect(r.stderr.trim().split("\n").length).toBe(1);
      expect(h.launches().length).toBe(0);
    });
  }

  test("an unparseable file exits 78 and names the file", async () => {
    h.plantAccount({ active: true });
    h.writeConfig("{ nope");
    const r = await h.run(["doctor"]);
    expect(r.exitCode).toBe(78);
    expect(r.stderr).toContain("config.json");
    expect(h.launches().length).toBe(0);
  });

  test("a Session start opens the file too", async () => {
    h.plantAccount({ active: true });
    h.writeConfig("{ nope");
    const r = await h.run(["-p", "hi"]);
    expect(r.exitCode).toBe(78);
  });
});

describe("commands that never open config.json", () => {
  beforeEach(() => {
    h.writeConfig("{ nope");
  });

  test("version still works with an unparseable file", async () => {
    const r = await h.run(["version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^mclaude \d/);
    expect(r.stdout).toContain("checked version");
    expect(r.stderr).toBe("");
  });

  test("hook still writes a Signal with an unparseable file", async () => {
    const limitDir = join(h.root, "limits", "session-1");
    const payload = { hook_event_name: "StopFailure", session_id: "session-1", error: "rate limit" };
    const r = await h.run(["hook"], {
      stdin: JSON.stringify(payload),
      env: { MCLAUDE_LIMIT_DIR: limitDir, MCLAUDE_ACCOUNT: "acct1xx" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    const files = readdirSync(limitDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^StopFailure-\d+\.json$/);
    const signal = JSON.parse(readFileSync(join(limitDir, files[0]!), "utf8"));
    expect(signal.payload).toEqual(payload);
    expect(signal.accountId).toBe("acct1xx");
    expect(typeof signal.receivedAt).toBe("string");
  });

  test.todo("account list works with an unparseable config.json", () => {});
  test.todo("account rename works with an unparseable config.json", () => {});
  test.todo("account remove works with an unparseable config.json", () => {});
  test.todo("account pin works with an unparseable config.json", () => {});
  test.todo("account unpin works with an unparseable config.json", () => {});
  test.todo("account enable works with an unparseable config.json", () => {});
  test.todo("account disable works with an unparseable config.json", () => {});
});

describe("claudePath precedence", () => {
  test("MCLAUDE_CLAUDE_PATH over config over PATH", async () => {
    h.plantAccount({ active: true });
    const fromEnv = markedClaude(join(h.root, "envbin"), "env");
    const fromConfig = markedClaude(join(h.root, "configbin"), "config");
    const pathBin = join(h.root, "pathbin");
    markedClaude(pathBin, "path");
    const PATH = `${pathBin}:${bunDir}:/usr/bin:/bin`;

    h.writeConfig(`{ "claudePath": "${fromConfig}" }`);
    let r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: fromEnv, PATH } });
    expect(r.exitCode).toBe(0);
    expect(h.launches()[0]!.env.WHICH_CLAUDE).toBe("env");

    r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: undefined, PATH } });
    expect(r.exitCode).toBe(0);
    expect(h.launches()[1]!.env.WHICH_CLAUDE).toBe("config");

    h.writeConfig(`{}`);
    r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: undefined, PATH } });
    expect(r.exitCode).toBe(0);
    expect(h.launches()[2]!.env.WHICH_CLAUDE).toBe("path");
  });

  test("a ~-prefixed claudePath expands against HOME", async () => {
    h.plantAccount({ active: true });
    markedClaude(join(h.home, "tools"), "tilde");
    h.writeConfig(`{ "claudePath": "~/tools/claude" }`);
    const r = await h.run(["doctor"], { env: { MCLAUDE_CLAUDE_PATH: undefined, PATH: `${bunDir}:/usr/bin:/bin` } });
    expect(r.exitCode).toBe(0);
    expect(h.launches()[0]!.env.WHICH_CLAUDE).toBe("tilde");
  });
});
