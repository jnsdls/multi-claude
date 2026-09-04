import { describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { forwardSignals } from "../src/spawn.ts";

describe("forwardSignals", () => {
  test("a signal raised before the child exists lands on the child once it appears", async () => {
    let child: Subprocess | undefined;
    const stop = forwardSignals(() => child);
    try {
      process.kill(process.pid, "SIGTERM");
      await new Promise((r) => setTimeout(r, 20));
      child = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      await child.exited;
      expect(child.signalCode).toBe("SIGTERM");
    } finally {
      stop();
      child?.kill("SIGKILL");
    }
  });

  test("a signal raised after the child exists is forwarded at once", async () => {
    const child = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const stop = forwardSignals(() => child);
    try {
      process.kill(process.pid, "SIGHUP");
      await child.exited;
      expect(child.signalCode).toBe("SIGHUP");
    } finally {
      stop();
      child.kill("SIGKILL");
    }
  });
});
