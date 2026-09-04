import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Harness } from "./harness/harness.ts";

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.cleanup());

function ids(h: Harness): string[] {
  const dir = join(h.mclaudeHome, "accounts");
  return existsSync(dir) ? require("node:fs").readdirSync(dir) : [];
}

/** A pid that is not alive: a child that already exited. */
async function deadPid(): Promise<number> {
  const p = Bun.spawn(["true"]);
  await p.exited;
  return p.pid;
}

describe("account add", () => {
  test("a successful add: dir before login, farm, seed, Record, active, one stdout line", async () => {
    writeFileSync(join(h.home, ".claude.json"), JSON.stringify({ theme: "light", numStartups: 3, oauthAccount: { accountUuid: "shared" }, projects: { "/p": { hasTrustDialogAccepted: true, lastCost: 1 } } }));
    mkdirSync(join(h.sharedHome, "plugins"));
    h.scenario({ login: { oauthAccount: { accountUuid: "acc-1", emailAddress: "me@example.com", organizationUuid: "org-1", organizationName: "Org" } } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(0);
    const [id] = ids(h);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(r.stdout).toBe(`me@example.com ${id} me@example.com max\n`);

    const login = h.calls().find((c) => c.kind === "auth login")!;
    expect(login.argv).toEqual(["auth", "login"]);
    expect(login.cwd).toBe(realpathSync(h.accountDir(id!)));
    expect(login.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(id!));
    expect(login.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(h.accountDir(id!));
    expect(statSync(h.accountDir(id!)).mode & 0o777).toBe(0o700);
    expect(lstatSync(join(h.accountDir(id!), "projects")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(h.accountDir(id!), "plugins")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(h.accountDir(id!), "settings.json")).isSymbolicLink()).toBe(true);

    // The seed was written before login; the fake login added oauthAccount on top of it.
    const copy = JSON.parse(readFileSync(join(h.accountDir(id!), ".claude.json"), "utf8"));
    expect(copy.theme).toBe("light");
    expect(copy.hasCompletedOnboarding).toBe(true);
    expect(copy.numStartups).toBeUndefined();
    expect(copy.projects).toEqual({ "/p": { hasTrustDialogAccepted: true } });
    expect(copy.oauthAccount.accountUuid).toBe("acc-1");

    const rec = h.readRecord(id!);
    expect(rec.version).toBe(1);
    expect(rec.id).toBe(id);
    expect(rec.alias).toBe("me@example.com");
    expect(rec.disabled).toBe(false);
    expect(rec.addedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(rec.identity).toMatchObject({ accountUuid: "acc-1", organizationUuid: "org-1", email: "me@example.com", organizationName: "Org", subscriptionType: "max" });
    expect(rec.identity.capturedAt).toMatch(/Z$/);
    // The one poll after login went to a closed port: attempted, nothing read.
    expect(rec.usage).toMatchObject({ lastGood: null, fetchedAt: null, backoffUntil: null, last429At: null });
    expect(rec.usage.lastAttemptAt).toMatch(/Z$/);
    expect(rec.lastLimit).toBeNull();
    expect(statSync(join(h.mclaudeHome, "state", `${id}.json`)).mode & 0o777).toBe(0o600);
    expect(h.readActive()).toBe(id!);
  });

  test("the second Account does not become Active and takes the given alias", async () => {
    const first = h.plantAccount({ active: true });
    h.scenario({ login: { oauthAccount: { accountUuid: "acc-2", emailAddress: "two@example.com", organizationUuid: "org-2", organizationName: "Org" }, subscriptionType: "pro" } });
    const r = await h.run(["account", "add", "work"]);
    expect(r.exitCode).toBe(0);
    expect(h.readActive()).toBe(first);
    const id = ids(h).find((i) => i !== first)!;
    expect(r.stdout).toBe(`work ${id} two@example.com pro\n`);
    expect(h.readRecord(id).alias).toBe("work");
  });

  test("--email and --sso are forwarded; --console is refused", async () => {
    h.scenario({});
    const r = await h.run(["account", "add", "--email", "x@y.z", "--sso"]);
    expect(r.exitCode).toBe(0);
    expect(h.calls().find((c) => c.kind === "auth login")!.argv).toEqual(["auth", "login", "--email", "x@y.z", "--sso"]);
    const bad = await h.run(["account", "add", "--console"]);
    expect(bad.exitCode).toBe(64);
    expect(h.calls().filter((c) => c.kind === "auth login")).toHaveLength(1);
  });

  test("a non-claude.ai login rolls back: logout called, dir gone, exit 1", async () => {
    h.scenario({ login: { authMethod: "console" } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("console");
    expect(h.calls().map((c) => c.kind)).toEqual(["auth login", "auth status", "auth logout"]);
    expect(ids(h)).toEqual([]);
    expect(existsSync(join(h.mclaudeHome, "state"))).toBe(false);
  });

  test("login exiting non-zero rolls back with exit 1", async () => {
    h.scenario({ login: { exit: 3 } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(1);
    expect(h.calls().map((c) => c.kind)).toEqual(["auth login", "auth logout"]);
    expect(ids(h)).toEqual([]);
  });

  test("a login that leaves no oauthAccount rolls back with exit 1", async () => {
    h.scenario({ login: { oauthAccount: null } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(1);
    expect(ids(h)).toEqual([]);
  });

  test("a duplicate identity exits 65 naming the existing Alias and leaves no dir", async () => {
    const id = h.plantAccount({ alias: "work", accountUuid: "acc-1", organizationUuid: "org-1" });
    h.scenario({ login: { oauthAccount: { accountUuid: "acc-1", emailAddress: "other@example.com", organizationUuid: "org-1", organizationName: "Org" } } });
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(65);
    expect(r.stderr).toContain("work");
    expect(r.stderr).toContain("account login work");
    expect(h.calls().at(-1)!.kind).toBe("auth logout");
    expect(ids(h)).toEqual([id]);
  });

  test("the same person in another organization is a second Account", async () => {
    h.plantAccount({ accountUuid: "acc-1", organizationUuid: "org-1", email: "me@example.com" });
    h.scenario({ login: { oauthAccount: { accountUuid: "acc-1", emailAddress: "me@example.com", organizationUuid: "org-2", organizationName: "Other" } } });
    const r = await h.run(["account", "add", "other"]);
    expect(r.exitCode).toBe(0);
    expect(ids(h)).toHaveLength(2);
  });

  test("an alias equal to an existing id or Alias is refused with 64 before any login", async () => {
    const id = h.plantAccount({ alias: "work" });
    h.scenario({});
    expect((await h.run(["account", "add", "work"])).exitCode).toBe(64);
    expect((await h.run(["account", "add", id])).exitCode).toBe(64);
    expect(h.calls()).toHaveLength(0);
  });

  test("claudePath from config.json is honoured and a broken config exits 78", async () => {
    h.writeConfig('{ "claudePath": 5 }');
    const r = await h.run(["account", "add"]);
    expect(r.exitCode).toBe(78);
  });
});

describe("account login", () => {
  test("logs in again in place keeping id and Alias", async () => {
    const id = h.plantAccount({ alias: "work", accountUuid: "acc-1", organizationUuid: "org-1", credential: null });
    h.scenario({ login: { oauthAccount: { accountUuid: "acc-1", emailAddress: "new@example.com", organizationUuid: "org-1", organizationName: "Org" }, subscriptionType: "team" } });
    const r = await h.run(["account", "login", "work"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(`work ${id} new@example.com team\n`);
    const login = h.calls().find((c) => c.kind === "auth login")!;
    expect(login.cwd).toBe(realpathSync(h.accountDir(id)));
    const rec = h.readRecord(id);
    expect(rec.alias).toBe("work");
    expect(rec.identity.email).toBe("new@example.com");
    expect(rec.identity.subscriptionType).toBe("team");
  });

  test("a changed identity exits 65 and is logged out again; the Record stays", async () => {
    const id = h.plantAccount({ alias: "work", accountUuid: "acc-1", organizationUuid: "org-1" });
    h.scenario({ login: { oauthAccount: { accountUuid: "acc-9", emailAddress: "x@example.com", organizationUuid: "org-1", organizationName: "Org" } } });
    const r = await h.run(["account", "login", id]);
    expect(r.exitCode).toBe(65);
    expect(h.calls().at(-1)!.kind).toBe("auth logout");
    expect(existsSync(h.accountDir(id))).toBe(true);
    expect(h.readRecord(id).identity.accountUuid).toBe("acc-1");
  });

  test("unknown Account exits 64", async () => {
    expect((await h.run(["account", "login", "nope"])).exitCode).toBe(64);
  });
});

describe("account list", () => {
  test("zero Accounts: one stderr hint, exit 0", async () => {
    const r = await h.run(["account", "list"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("account add");
  });

  test("ordering, markers and states", async () => {
    const old = h.plantAccount({ alias: "old", addedAt: "2026-01-01T00:00:00.000Z" });
    const active = h.plantAccount({ alias: "act", addedAt: "2026-03-01T00:00:00.000Z", active: true });
    const gone = h.plantAccount({ alias: "gone", addedAt: "2026-02-01T00:00:00.000Z", credential: null });
    const off = h.plantAccount({ alias: "off", addedAt: "2026-04-01T00:00:00.000Z", disabled: true, subscriptionType: "pro" });
    const dead = h.plantAccount({ alias: "dead", addedAt: "2026-05-01T00:00:00.000Z", expiresAt: 0 });
    h.setPinned(old);
    h.plantOrphan("orphan01");
    const r = await h.run(["account", "list"]);
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^\s+ALIAS\s+ID\s+PLAN\s+SESSION\s+WEEK\s+MODEL WINDOWS\s+AGE\s+STATE$/);
    const rows = lines.slice(1).map((l) => l.replace(/^[*!]*/, "").trim().split(/\s{2,}/));
    expect(rows.map((c) => (c[0] === "-" ? c[1] : c[0]))).toEqual(["act", "old", "gone", "off", "dead", "orphan01"]);
    expect(lines[1]!.startsWith("*")).toBe(true);
    expect(lines[2]!.startsWith("!")).toBe(true);
    expect(rows.map((c) => c.at(-1))).toEqual(["unknown", "unknown", "needs login", "disabled", "needs login", "orphan"]);
    const offRow = rows[3]!;
    expect(offRow).toEqual(["off", off, "pro", "-", "-", "-", "-", "disabled"]);
    expect(r.stdout).toContain(active);
    expect(r.stdout).toContain(gone);
    expect(r.stdout).toContain(dead);
    expect(r.stdout).not.toContain("sk-ant-");
  });

  test("Active and pinned on the same Account shows *!", async () => {
    const id = h.plantAccount({ active: true });
    h.setPinned(id);
    const r = await h.run(["account", "list"]);
    expect(r.stdout.split("\n")[1]!.startsWith("*!")).toBe(true);
  });

  test("usage columns render from a Reading in the Record", async () => {
    const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
    const week = new Date(Date.now() + 3 * 86400_000).toISOString();
    h.plantAccount({
      alias: "u",
      usage: {
        lastGood: {
          five_hour: { utilization: 42, resets_at: soon },
          seven_day: { utilization: 7, resets_at: week },
          limits: [{ kind: "weekly_scoped", percent: 12, resets_at: week, scope: { model: { id: null, display_name: "Opus" } } }],
          extra_usage: { is_enabled: false },
        },
        fetchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    });
    const r = await h.run(["account", "list"]);
    const row = r.stdout.split("\n")[1]!;
    expect(row).toContain("42% ↻ in 1h");
    expect(row).toContain("7% ↻ in 2d");
    expect(row).toContain("Opus 12% ↻ in 2d");
    expect(row).toMatch(/\s5m\s+ok$/);
  });

  test("--json: Records verbatim plus active, pinned and state", async () => {
    const a = h.plantAccount({ alias: "a", active: true });
    const b = h.plantAccount({ alias: "b", credential: null });
    h.setPinned(b);
    h.plantOrphan("orphan01");
    const r = await h.run(["account", "list", "--json"]);
    expect(r.exitCode).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.active).toBe(a);
    expect(body.pinned).toBe(b);
    expect(body.accounts.map((x: any) => x.id)).toEqual([a, b]);
    expect(body.accounts[0].state).toBe("unknown");
    expect(body.accounts[1].state).toBe("needs login");
    const { state, ...rest } = body.accounts[0];
    expect(rest).toEqual(h.readRecord(a));
    expect(body.orphans).toEqual([{ id: "orphan01", state: "orphan" }]);
  });

  test("an unknown flag exits 64; --refresh is accepted", async () => {
    h.plantAccount({});
    expect((await h.run(["account", "list", "--bogus"])).exitCode).toBe(64);
    expect((await h.run(["account", "list", "--refresh"])).exitCode).toBe(0);
  });

  test("never opens config.json", async () => {
    h.plantAccount({});
    h.writeConfig("this is not json");
    expect((await h.run(["account", "list"])).exitCode).toBe(0);
  });
});

describe("account rename", () => {
  test("changes the Alias under the write rule", async () => {
    const id = h.plantAccount({ alias: "old" });
    const r = await h.run(["account", "rename", "old", "new"]);
    expect(r.exitCode).toBe(0);
    expect(h.readRecord(id).alias).toBe("new");
    expect((await h.run(["account", "rename", id, "new"])).exitCode).toBe(0);
  });

  test("refuses an alias equal to any id or Alias, or an unknown Account", async () => {
    const a = h.plantAccount({ alias: "a" });
    h.plantAccount({ alias: "b" });
    expect((await h.run(["account", "rename", "a", "b"])).exitCode).toBe(64);
    expect((await h.run(["account", "rename", "b", a])).exitCode).toBe(64);
    expect((await h.run(["account", "rename", "zzz", "c"])).exitCode).toBe(64);
    expect((await h.run(["account", "rename", "a"])).exitCode).toBe(64);
    expect(h.readRecord(a).alias).toBe("a");
  });
});

describe("account remove", () => {
  test("no TTY and no --yes exits 64 and touches nothing", async () => {
    const id = h.plantAccount({ alias: "work" });
    const r = await h.run(["account", "remove", "work"]);
    expect(r.exitCode).toBe(64);
    expect(existsSync(h.accountDir(id))).toBe(true);
    expect(h.calls()).toHaveLength(0);
  });

  test("--yes logs out, deletes dir, Record and matching pointers", async () => {
    const id = h.plantAccount({ alias: "work", active: true });
    h.setPinned(id);
    const r = await h.run(["account", "remove", "work", "--yes"]);
    expect(r.exitCode).toBe(0);
    const logout = h.calls().find((c) => c.kind === "auth logout")!;
    expect(logout.cwd.endsWith(`/accounts/${id}`)).toBe(true);
    expect(logout.env.CLAUDE_CONFIG_DIR).toBe(h.accountDir(id));
    expect(existsSync(h.accountDir(id))).toBe(false);
    expect(existsSync(join(h.mclaudeHome, "state", `${id}.json`))).toBe(false);
    expect(h.readActive()).toBeNull();
    expect(h.readPinned()).toBeNull();
  });

  test("leaves another Account's pointers alone", async () => {
    const keep = h.plantAccount({ alias: "keep", active: true });
    h.setPinned(keep);
    h.plantAccount({ alias: "drop" });
    expect((await h.run(["account", "remove", "drop", "--yes"])).exitCode).toBe(0);
    expect(h.readActive()).toBe(keep);
    expect(h.readPinned()).toBe(keep);
  });

  test("a live Run marker refuses with exit 1 listing the pid unless --force", async () => {
    const id = h.plantAccount({ alias: "busy" });
    const runDir = join(h.accountDir(id), ".mclaude", "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, String(process.pid)), "now\n");
    const r = await h.run(["account", "remove", "busy", "--yes"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(String(process.pid));
    expect(existsSync(h.accountDir(id))).toBe(true);
    const forced = await h.run(["account", "remove", "busy", "--yes", "--force"]);
    expect(forced.exitCode).toBe(0);
    expect(existsSync(h.accountDir(id))).toBe(false);
  });

  test("a stale Run marker does not block removal", async () => {
    const id = h.plantAccount({ alias: "stale" });
    const runDir = join(h.accountDir(id), ".mclaude", "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, String(await deadPid())), "then\n");
    const r = await h.run(["account", "remove", id, "--yes"]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(h.accountDir(id))).toBe(false);
  });

  test("a failing logout warns with the Keychain service name and still deletes", async () => {
    const id = h.plantAccount({ alias: "locked" });
    h.scenario({ logout: { exit: 1, keepCredential: true } });
    const r = await h.run(["account", "remove", "locked", "--yes"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/Claude Code-credentials-[0-9a-f]{8}/);
    expect(existsSync(h.accountDir(id))).toBe(false);
    expect(existsSync(join(h.mclaudeHome, "state", `${id}.json`))).toBe(false);
  });

  test("accepts an Orphan id", async () => {
    h.plantOrphan("orphan01");
    const r = await h.run(["account", "remove", "orphan01", "--yes"]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(h.accountDir("orphan01"))).toBe(false);
  });

  test("unknown name exits 64", async () => {
    expect((await h.run(["account", "remove", "nope", "--yes"])).exitCode).toBe(64);
  });

  test("never opens config.json", async () => {
    h.plantAccount({ alias: "x" });
    h.writeConfig("{{{");
    expect((await h.run(["account", "remove", "x", "--yes"])).exitCode).toBe(0);
  });
});

describe("account", () => {
  test("bare `mclaude account` prints help with 64", async () => {
    const r = await h.run(["account"]);
    expect(r.exitCode).toBe(64);
    expect(r.stderr).toContain("usage");
  });
});
