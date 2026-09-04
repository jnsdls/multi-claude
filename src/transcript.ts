// The Handoff resend rule (ADR 0009), pure over the transcript's JSONL lines:
// the last user text message with no assistant content after it is resent
// verbatim; otherwise a fixed nudge. "No assistant content" rather than
// "followed by the rate_limit error", because a host retry that reaches the
// old child inside the kill window leaves a dangling user message with no
// error entry, and that retry is what should run.

export const HANDOFF_NUDGE = "Continue from where you left off. The previous attempt stopped at a usage limit.";

export type Resend = { kind: "verbatim"; text: string } | { kind: "nudge"; text: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * The text of a user message when it is user text: a string, or blocks that
 * are all `text`. A `tool_result` block is not user text. Null otherwise.
 */
export function userText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isObject(block) || block.type !== "text" || typeof block.text !== "string") return null;
    parts.push(block.text);
  }
  return parts.join("");
}

function parseLines(lines: readonly string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (isObject(v)) out.push(v);
    } catch {
      // A torn last line is the transcript still being written; skip it.
    }
  }
  return out;
}

/**
 * Walks the entries in order. An assistant entry that is only the rate_limit
 * error (`isApiErrorMessage`) and any synthetic entry (`isMeta`) do not count
 * as assistant content. Empty or missing transcript: the nudge.
 */
export function resendFor(transcript: readonly string[] | string | null | undefined): Resend {
  const lines = transcript == null ? [] : typeof transcript === "string" ? transcript.split("\n") : transcript;
  let lastUser: string | null = null;
  let assistantAfter = false;
  for (const entry of parseLines(lines)) {
    if (entry.isMeta === true) continue;
    const message = isObject(entry.message) ? entry.message : {};
    if (entry.type === "user") {
      const text = userText(message.content);
      if (text !== null) {
        lastUser = text;
        assistantAfter = false;
      }
    } else if (entry.type === "assistant" && entry.isApiErrorMessage !== true) {
      assistantAfter = true;
    }
  }
  if (lastUser !== null && lastUser.trim() !== "" && !assistantAfter) return { kind: "verbatim", text: lastUser };
  return { kind: "nudge", text: HANDOFF_NUDGE };
}
