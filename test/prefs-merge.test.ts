import { describe, expect, test } from "bun:test";
import { mergePreferences, seedClaudeJson } from "../src/prefs.ts";

describe("mergePreferences", () => {
  const cases: { name: string; shared: Record<string, unknown>; account: Record<string, unknown>; expect: Record<string, unknown> }[] = [
    {
      name: "Shared wins per key, missing Shared key keeps the Account value",
      shared: { theme: "light" },
      account: { theme: "dark", editorMode: "vim" },
      expect: { theme: "light", editorMode: "vim" },
    },
    {
      name: "top-level mcpServers replaced whole",
      shared: { mcpServers: { a: { command: "a" } } },
      account: { mcpServers: { a: { command: "old" }, b: { command: "b" } } },
      expect: { mcpServers: { a: { command: "a" } } },
    },
    {
      name: "per-project mcpServers replaced whole",
      shared: { projects: { "/p": { mcpServers: { a: {} } } } },
      account: { projects: { "/p": { mcpServers: { b: {} } } } },
      expect: { projects: { "/p": { mcpServers: { a: {} } } } },
    },
    {
      name: "approval booleans OR",
      shared: {
        projects: {
          "/p": { hasTrustDialogAccepted: false, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: false },
        },
      },
      account: { projects: { "/p": { hasTrustDialogAccepted: true, hasClaudeMdExternalIncludesApproved: false } } },
      expect: {
        projects: {
          "/p": { hasTrustDialogAccepted: true, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: false },
        },
      },
    },
    {
      name: "mcpjson lists union, Shared wins a conflict",
      shared: { projects: { "/p": { enabledMcpjsonServers: ["a", "b"], disabledMcpjsonServers: ["c"] } } },
      account: { projects: { "/p": { enabledMcpjsonServers: ["c", "d"], disabledMcpjsonServers: ["a", "e"] } } },
      expect: { projects: { "/p": { enabledMcpjsonServers: ["a", "b", "d"], disabledMcpjsonServers: ["c", "e"] } } },
    },
    {
      name: "project entries only in the Account copy are kept",
      shared: { projects: { "/p": { allowedTools: ["x"] } } },
      account: { projects: { "/q": { hasTrustDialogAccepted: true } } },
      expect: { projects: { "/p": { allowedTools: ["x"] }, "/q": { hasTrustDialogAccepted: true } } },
    },
    {
      name: "keys outside the allowlist untouched on both sides",
      shared: { oauthAccount: { accountUuid: "shared" }, numStartups: 99, projects: { "/p": { lastCost: 5, history: [1] } } },
      account: { oauthAccount: { accountUuid: "mine" }, numStartups: 1, projects: { "/p": { lastCost: 1 } } },
      expect: { oauthAccount: { accountUuid: "mine" }, numStartups: 1, projects: { "/p": { lastCost: 1 } } },
    },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const sharedBefore = JSON.stringify(c.shared);
      expect(mergePreferences(c.shared, c.account)).toEqual(c.expect);
      expect(JSON.stringify(c.shared)).toBe(sharedBefore);
    });
  }

  test("returns a new object and leaves the Account input untouched", () => {
    const account = { theme: "dark" };
    const out = mergePreferences({ theme: "light" }, account);
    expect(account.theme).toBe("dark");
    expect(out).not.toBe(account);
  });
});

describe("seedClaudeJson", () => {
  test("the allowlist plus hasCompletedOnboarding, nothing else", () => {
    const seed = seedClaudeJson({
      theme: "light",
      oauthAccount: { accountUuid: "x" },
      numStartups: 4,
      hasCompletedOnboarding: false,
      projects: { "/p": { hasTrustDialogAccepted: true, lastCost: 3 }, "/q": { history: [] } },
    });
    expect(seed).toEqual({
      theme: "light",
      hasCompletedOnboarding: true,
      projects: { "/p": { hasTrustDialogAccepted: true }, "/q": {} },
    });
  });

  test("an empty Shared copy seeds only the onboarding flag", () => {
    expect(seedClaudeJson({})).toEqual({ hasCompletedOnboarding: true });
  });
});
