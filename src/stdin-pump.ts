// The stream-json stdin pump (ADR 0006): on the one path where mclaude sits
// between the host and the child's stdin, it reads the host's lines and writes
// each to the current child. With no child attached, lines queue; a Handoff
// detaches before the kill and reattaches after the resend, so nothing the
// host wrote during the Handoff is lost.
import type { Subprocess } from "bun";
import { userText } from "./transcript.ts";

export interface StdinPump {
  /**
   * Forwards to this child from now on: `first` goes in ahead of the queue,
   * then the queued lines minus those `drop` rejects, then end-of-file when the
   * host already closed its side.
   */
  attach(child: Subprocess, opts?: { first?: string; drop?: (line: string) => boolean }): void;
  /** Stops forwarding; lines queue until the next attach. */
  detach(): void;
  /** The host's own `{"type":"user"}` line carrying this text, so a verbatim resend keeps the host's fields. */
  userLineFor(text: string): string | null;
  /** True once the host closed its side. */
  hostClosed(): boolean;
}

/** The user text of a stream-json line when it is a user message, else null. */
export function userTextOfLine(line: string): string | null {
  try {
    const v = JSON.parse(line);
    if (!v || typeof v !== "object" || v.type !== "user") return null;
    const message = v.message;
    return message && typeof message === "object" ? userText(message.content) : null;
  } catch {
    return null;
  }
}

/** How many distinct user texts the pump remembers a host line for. */
export const USER_LINES_KEPT = 64;

/** A stream-json user message carrying `text`. */
export function userMessageLine(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } });
}

function writeLine(child: Subprocess, line: string): void {
  const sink = child.stdin;
  if (!sink || typeof sink === "number") return;
  try {
    sink.write(`${line}\n`);
    sink.flush();
  } catch {
    // The child is gone; the line is lost the way it would be against claude itself.
  }
}

function endStdin(child: Subprocess): void {
  const sink = child.stdin;
  if (!sink || typeof sink === "number") return;
  try {
    sink.end();
  } catch {
    // Already closed.
  }
}

export function startStdinPump(source: ReadableStream<Uint8Array> = Bun.stdin.stream()): StdinPump {
  let target: Subprocess | null = null;
  const queued: string[] = [];
  // The most recent host line per user text, bounded so a long session does not grow it forever.
  const userLines = new Map<string, string>();
  let closed = false;

  const forward = (line: string) => {
    if (target) writeLine(target, line);
    else queued.push(line);
  };

  (async () => {
    let buf = "";
    try {
      for await (const chunk of source) {
        buf += Buffer.from(chunk).toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const text = userTextOfLine(line);
          if (text !== null) {
            userLines.delete(text);
            userLines.set(text, line);
            if (userLines.size > USER_LINES_KEPT) userLines.delete(userLines.keys().next().value!);
          }
          forward(line);
        }
      }
      if (buf.trim()) forward(buf);
    } catch {
      // stdin went away; treat it as closed.
    }
    closed = true;
    if (target) endStdin(target);
  })();

  return {
    attach(child, opts = {}) {
      target = child;
      if (opts.first !== undefined) writeLine(child, opts.first);
      for (const line of queued.splice(0)) if (!opts.drop?.(line)) writeLine(child, line);
      if (closed) endStdin(child);
    },
    detach() {
      target = null;
    },
    userLineFor: (text) => userLines.get(text) ?? null,
    hostClosed: () => closed,
  };
}
