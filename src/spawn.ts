// Spawning claude: inherited stdio (ADR 0006), forwarded signals, mirrored exit.
import type { Subprocess } from "bun";

export interface SpawnOptions {
  argv: string[];
  env: Record<string, string>;
  cwd?: string;
  stdin?: "inherit" | "pipe" | "ignore";
  stdout?: "inherit" | "pipe" | "ignore";
  stderr?: "inherit" | "pipe" | "ignore";
}

export function spawnClaude(claudePath: string, opts: SpawnOptions): Subprocess {
  return Bun.spawn([claudePath, ...opts.argv], {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin ?? "inherit",
    stdout: opts.stdout ?? "inherit",
    stderr: opts.stderr ?? "inherit",
  });
}

export type ForwardedSignal = "SIGTERM" | "SIGHUP";
export const FORWARDED_SIGNALS: ForwardedSignal[] = ["SIGTERM", "SIGHUP"];

/**
 * Forwards SIGTERM and SIGHUP to whichever child `current()` returns, so a
 * Handoff can swap the child without re-registering. Returns a disposer.
 */
export function forwardSignals(current: () => Subprocess | undefined): () => void {
  const handlers = FORWARDED_SIGNALS.map((sig) => {
    const h = () => {
      const c = current();
      if (c && c.exitCode === null && c.signalCode === null) c.kill(sig);
    };
    process.on(sig, h);
    return [sig, h] as const;
  });
  return () => {
    for (const [sig, h] of handlers) process.off(sig, h);
  };
}

/** Mirrors the child's exit: same code, or the same signal re-raised on mclaude. */
export function exitLike(child: Subprocess): never {
  const sig = child.signalCode;
  if (sig) {
    for (const s of FORWARDED_SIGNALS) process.removeAllListeners(s);
    try {
      process.kill(process.pid, sig);
    } catch {
      // fall through to a conventional 128+n exit below
    }
    // A caught or ignored signal returns here; exit the way a shell would report it.
    process.exit(128 + signalNumber(sig));
  }
  process.exit(child.exitCode ?? 1);
}

function signalNumber(sig: string): number {
  const table: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGABRT: 6,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return table[sig] ?? 15;
}

/** Runs a claude command to completion with captured output. */
export async function runCaptured(
  claudePath: string,
  argv: string[],
  env: Record<string, string>,
  opts: { cwd?: string; timeoutMs?: number; stdin?: "ignore" | "inherit" } = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const child = Bun.spawn([claudePath, ...argv], {
    cwd: opts.cwd,
    env,
    stdin: opts.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
  }
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout as ReadableStream).text(),
    new Response(child.stderr as ReadableStream).text(),
  ]);
  const exitCode = await child.exited;
  if (timer) clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
}
