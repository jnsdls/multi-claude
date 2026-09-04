import { describe, expect, test } from "bun:test";
import { buildChildEnv } from "../src/env.ts";

describe("buildChildEnv", () => {
  test("scrubs the five markers, keeps the rest, sets exactly four", () => {
    const base = {
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_EVAL_INTERVIEW_SESSION: "1",
      CLAUDE_CODE_BRIDGE_SESSION_ID: "b",
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
      CLAUDE_AGENT_SDK_VERSION: "0.3.259",
      USER: "me",
      CLAUDE_CONFIG_DIR: "/inherited",
      CLAUDE_SECURESTORAGE_CONFIG_DIR: "/inherited",
      MCLAUDE_ACCOUNT: "parent",
      MCLAUDE_LIMIT_DIR: "/parent/limits",
      OTHER: "x",
    };
    const env = buildChildEnv({
      base,
      accountDir: "/h/.mclaude/accounts/abc",
      accountId: "abc",
      limitDir: "/h/.mclaude/limits/s",
    });
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_EVAL_INTERVIEW_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_BRIDGE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-ts");
    expect(env.CLAUDE_AGENT_SDK_VERSION).toBe("0.3.259");
    expect(env.USER).toBe("me");
    expect(env.OTHER).toBe("x");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/h/.mclaude/accounts/abc");
    expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe("/h/.mclaude/accounts/abc");
    expect(env.MCLAUDE_ACCOUNT).toBe("abc");
    expect(env.MCLAUDE_LIMIT_DIR).toBe("/h/.mclaude/limits/s");
  });
  test("the usage endpoint override never reaches a child", () => {
    const env = buildChildEnv({ base: { MCLAUDE_USAGE_URL: "http://127.0.0.1:1" }, accountDir: "/a", accountId: "a" });
    expect(env.MCLAUDE_USAGE_URL).toBeUndefined();
  });
  test("inherited mclaude variables never leak when not set", () => {
    const env = buildChildEnv({
      base: { MCLAUDE_LIMIT_DIR: "/x", CLAUDE_CONFIG_DIR: "/y" },
      accountDir: "/a",
      accountId: "a",
    });
    expect(env.MCLAUDE_LIMIT_DIR).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe("/a");
  });
});
