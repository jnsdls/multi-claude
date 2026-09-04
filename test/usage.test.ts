import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Harness, REPO_ROOT, usageBody } from "./harness/harness.ts";

const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version as string;

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

/** A Reading taken five minutes ago: stale for `--refresh`, still standing. */
function staleReading() {
  return {
    lastGood: {
      five_hour: { utilization: 42, resets_at: ahead(2 * 3600_000) },
      seven_day: { utilization: 7, resets_at: ahead(3 * 86400_000) },
      limits: [{ kind: "weekly_scoped", percent: 12, resets_at: ahead(3 * 86400_000), scope: { model: { id: null, display_name: "Opus" } } }],
      extra_usage: { is_enabled: false },
    },
    fetchedAt: ago(5 * 60_000),
    lastAttemptAt: ago(5 * 60_000),
  };
}

function cells(stdout: string, line = 1): string[] {
  return stdout.split("\n")[line]!.replace(/^[*!]*/, "").trim().split(/\s{2,}/);
}

/** Alias to STATE for every row, whatever the order. */
function states(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.trimEnd().split("\n").slice(1)) {
    const c = line.replace(/^[*!]*/, "").trim().split(/\s{2,}/);
    out[c[0]!] = c.at(-1)!;
  }
  return out;
}

const hollow = {
  five_hour: { utilization: 0, resets_at: null },
  seven_day: { utilization: 0, resets_at: null },
  limits: [],
  extra_usage: { is_enabled: false, spend_limit_reached: false },
};

describe("list --refresh", () => {
  test("sends the bearer token, the beta header and mclaude's user agent", async () => {
    const id = h.plantAccount({ alias: "a" });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(1);
    const req = usage.requests[0]!;
    expect(req.path).toBe("/api/oauth/usage");
    expect(req.token).toBe(`sk-ant-oat01-${id}`);
    expect(req.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(req.headers["user-agent"]).toBe(`mclaude/${VERSION}`);
    expect(req.headers.accept).toBe("application/json");
  });

  test("a healthy body with a scoped Window fills the table and the Record", async () => {
    const id = h.plantAccount({ alias: "a" });
    await h.startUsage({ default: { body: usageBody({ session: 42, week: 7, scoped: [{ name: "Opus", percent: 12 }, { name: "Sonnet", percent: 3 }] }) } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    const row = cells(r.stdout);
    expect(row).toEqual(["a", id, "max", "42% ↻ in 2h", "7% ↻ in 2d", "Opus 12% ↻ in 2d Sonnet 3% ↻ in 2d", "0s", "ok"]);
    const rec = h.readRecord(id);
    expect(rec.usage.lastGood.five_hour.utilization).toBe(42);
    expect(rec.usage.lastGood.limits.map((l: any) => l.kind)).toEqual(["session", "weekly_all", "weekly_scoped", "weekly_scoped"]);
    expect(rec.usage.lastGood.extra_usage).toEqual({ is_enabled: false, spend_limit_reached: false });
    expect(rec.usage.fetchedAt).toMatch(/Z$/);
    expect(rec.usage.lastAttemptAt).toBe(rec.usage.fetchedAt);
    expect(rec.usage.backoffUntil).toBeNull();
  });

  test("Utilization and Resets survive a restart: the second list makes no request", async () => {
    h.plantAccount({ alias: "a" });
    const usage = await h.startUsage({ default: { body: usageBody({ session: 42 }) } });
    await h.run(["account", "list", "--refresh"]);
    const r = await h.run(["account", "list"]);
    expect(cells(r.stdout)[3]).toBe("42% ↻ in 2h");
    expect(usage.requests).toHaveLength(1);
  });

  test("a hollow body keeps the last Reading and its age", async () => {
    const id = h.plantAccount({ alias: "a", usage: staleReading() });
    const before = h.readRecord(id).usage;
    await h.startUsage({ default: { body: hollow } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    const row = cells(r.stdout);
    expect(row.slice(3)).toEqual(["42% ↻ in 1h", "7% ↻ in 2d", "Opus 12% ↻ in 2d", "5m", "ok"]);
    const after = h.readRecord(id).usage;
    expect(after.lastGood).toEqual(before.lastGood);
    expect(after.fetchedAt).toBe(before.fetchedAt);
    expect(after.lastAttemptAt).not.toBe(before.lastAttemptAt);
    expect(r.stderr).toContain("mclaude: a:");
  });

  test("a partly hollow body keeps only the Windows it says nothing about", async () => {
    const id = h.plantAccount({ alias: "a", usage: staleReading() });
    await h.startUsage({ default: { body: { ...usageBody({ session: 0, week: 9, sessionResetsAt: null }) } } });
    await h.run(["account", "list", "--refresh"]);
    const rec = h.readRecord(id).usage;
    expect(rec.lastGood.five_hour.utilization).toBe(42);
    expect(rec.lastGood.seven_day.utilization).toBe(9);
    expect(rec.fetchedAt).toBe(rec.lastAttemptAt);
  });

  const retryCases: [string, Record<string, string>, number][] = [
    ["no Retry-After", {}, 300],
    ["Retry-After: 0", { "retry-after": "0" }, 300],
    ["Retry-After: 60", { "retry-after": "60" }, 960],
  ];
  for (const [name, headers, seconds] of retryCases) {
    test(`a 429 with ${name} backs off ${seconds} s and keeps the Reading`, async () => {
      const id = h.plantAccount({ alias: "a", usage: staleReading() });
      const before = h.readRecord(id).usage;
      await h.startUsage({ default: { status: 429, headers, body: { error: { type: "rate_limit_error", message: "Rate limited." } } } });
      const t0 = Date.now();
      const r = await h.run(["account", "list", "--refresh"]);
      expect(r.exitCode).toBe(0);
      const after = h.readRecord(id).usage;
      expect(after.lastGood).toEqual(before.lastGood);
      expect(after.fetchedAt).toBe(before.fetchedAt);
      expect(Math.abs(Date.parse(after.backoffUntil) - (t0 + seconds * 1000))).toBeLessThan(10_000);
      expect(Math.abs(Date.parse(after.last429At) - t0)).toBeLessThan(10_000);
      expect(after.lastAttemptAt).toBe(after.last429At);
      expect(cells(r.stdout).at(-1)).toBe("ok");
      expect(r.stderr).toContain("throttled");
    });
  }

  test("a timeout gives up after about 5 s and keeps the Reading", async () => {
    const id = h.plantAccount({ alias: "a", usage: staleReading() });
    const before = h.readRecord(id).usage;
    await h.startUsage({ default: { hang: true } });
    const t0 = Date.now();
    const r = await h.run(["account", "list", "--refresh"]);
    const elapsed = Date.now() - t0;
    expect(r.exitCode).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(12_000);
    const after = h.readRecord(id).usage;
    expect(after.lastGood).toEqual(before.lastGood);
    expect(after.fetchedAt).toBe(before.fetchedAt);
    expect(after.backoffUntil).toBeNull();
    expect(cells(r.stdout).slice(3)).toEqual(["42% ↻ in 1h", "7% ↻ in 2d", "Opus 12% ↻ in 2d", "5m", "ok"]);
    expect(r.stderr).toContain("timeout");
  }, 30_000);

  test("a non-JSON body and a 500 keep the Reading", async () => {
    const a = h.plantAccount({ alias: "a", usage: staleReading() });
    const b = h.plantAccount({ alias: "b", usage: staleReading() });
    await h.startUsage({ byToken: { [`sk-ant-oat01-${a}`]: { body: "<html>" }, [`sk-ant-oat01-${b}`]: { status: 500, body: {} } } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    expect(h.readRecord(a).usage.lastGood.five_hour.utilization).toBe(42);
    expect(h.readRecord(b).usage.lastGood.five_hour.utilization).toBe(42);
    expect(r.stderr.trim().split("\n")).toHaveLength(2);
  });

  test("a Needs login Account is never requested", async () => {
    h.plantAccount({ alias: "gone", credential: null });
    h.plantAccount({ alias: "dead", expiresAt: 0 });
    const ok = h.plantAccount({ alias: "ok" });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(usage.requests.map((q) => q.token)).toEqual([`sk-ant-oat01-${ok}`]);
    expect(states(r.stdout)).toEqual({ gone: "needs login", dead: "needs login", ok: "ok" });
  });

  test("a token without the user:profile scope is never requested", async () => {
    h.plantAccount({
      alias: "setup",
      credential: { claudeAiOauth: { accessToken: "sk-ant-oat01-x", refreshToken: "sk-ant-ort01-x", expiresAt: Date.now() + 3600_000, scopes: ["user:inference"], subscriptionType: "max" } },
    });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(usage.requests).toHaveLength(0);
    expect(cells(r.stdout).at(-1)).toBe("unknown");
    expect(r.stderr).toContain("user:profile");
  });

  test("an Account in backoff is not requested; one whose backoff passed is", async () => {
    h.plantAccount({ alias: "held", usage: { ...staleReading(), backoffUntil: ahead(60_000) } });
    const free = h.plantAccount({ alias: "free", usage: { ...staleReading(), backoffUntil: ago(1) } });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["account", "list", "--refresh"]);
    expect(usage.requests.map((q) => q.token)).toEqual([`sk-ant-oat01-${free}`]);
    expect(h.readRecord(free).usage.backoffUntil).toBeNull();
  });

  test("a fresh Reading is not requested again; Disabled is still polled", async () => {
    h.plantAccount({ alias: "fresh", usage: { ...staleReading(), fetchedAt: ago(10_000) } });
    const off = h.plantAccount({ alias: "off", disabled: true });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(usage.requests.map((q) => q.token)).toEqual([`sk-ant-oat01-${off}`]);
    expect(states(r.stdout)).toEqual({ fresh: "ok", off: "disabled" });
  });

  test("never opens config.json", async () => {
    h.plantAccount({});
    h.writeConfig("{{{");
    await h.startUsage({ default: { body: usageBody() } });
    expect((await h.run(["account", "list", "--refresh"])).exitCode).toBe(0);
  });

  test("many Accounts are all polled", async () => {
    for (let i = 0; i < 12; i++) h.plantAccount({});
    const usage = await h.startUsage({ default: { body: usageBody(), delayMs: 100 } });
    const r = await h.run(["account", "list", "--refresh"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests).toHaveLength(12);
    expect(new Set(usage.requests.map((q) => q.token)).size).toBe(12);
  });
});

describe("list without --refresh", () => {
  test("makes zero requests", async () => {
    h.plantAccount({});
    h.plantAccount({ usage: staleReading() });
    const usage = await h.startUsage({ default: { body: usageBody() } });
    await h.run(["account", "list"]);
    await h.run(["account", "list", "--json"]);
    expect(usage.requests).toHaveLength(0);
  });

  test("--json keeps its shape", async () => {
    const id = h.plantAccount({ usage: staleReading() });
    const r = await h.run(["account", "list", "--json"]);
    const body = JSON.parse(r.stdout);
    expect(Object.keys(body)).toEqual(["active", "pinned", "accounts", "orphans"]);
    const { state, ...rest } = body.accounts[0];
    expect(state).toBe("ok");
    expect(rest).toEqual(h.readRecord(id));
  });

  test("a passed Reset after a failed refresh shows unknown", async () => {
    h.plantAccount({
      usage: {
        lastGood: { five_hour: { utilization: 42, resets_at: ago(60_000) }, seven_day: null, limits: [], extra_usage: { is_enabled: false } },
        fetchedAt: ago(3600_000),
        lastAttemptAt: ago(10_000),
      },
    });
    const r = await h.run(["account", "list"]);
    expect(cells(r.stdout).at(-1)).toBe("unknown");
    expect(cells(r.stdout)[3]).toBe("42% ↻ now");
  });
});

describe("account add", () => {
  test("polls once after the Record is written", async () => {
    h.scenario({});
    const usage = await h.startUsage({ default: { body: usageBody({ session: 21 }) } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(0);
    expect(usage.requests.map((q) => q.token)).toEqual(["sk-ant-oat01-fake"]);
    const id = r.stdout.trim().split(" ")[1]!;
    expect(h.readRecord(id).usage.lastGood.five_hour.utilization).toBe(21);
    expect(h.readRecord(id).usage.fetchedAt).toMatch(/Z$/);
  });

  test("a failed poll is not a failed add", async () => {
    h.scenario({});
    await h.startUsage({ default: { status: 429 } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^user@example.com [a-z0-9]{8} user@example.com max\n$/);
    expect(r.stderr).toContain("throttled");
  });
});
