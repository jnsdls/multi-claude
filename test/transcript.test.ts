// The resend rule (ADR 0009) as a table over transcript shapes.
import { describe, expect, test } from "bun:test";
import { HANDOFF_NUDGE, resendFor, userText, type Resend } from "../src/transcript.ts";

const WALL = "You've hit your session limit · resets 3:45pm";
const PROMPT = "please refactor the parser";

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: "user",
  message: { role: "user", content },
  ...extra,
});
const assistant = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { role: "assistant", content },
  ...extra,
});
const error = () => assistant([{ type: "text", text: WALL }], { isApiErrorMessage: true, error: "rate_limit" });
const jsonl = (entries: unknown[]) => entries.map((e) => JSON.stringify(e));

describe("resendFor", () => {
  const cases: [name: string, entries: unknown[], expected: Resend][] = [
    ["pre-turn wall: user text then the error entry", [user(PROMPT), error()], { kind: "verbatim", text: PROMPT }],
    [
      "mid-turn wall: user text, tool_use, tool_result, error",
      [
        user(PROMPT),
        assistant([{ type: "tool_use", id: "t1", name: "Read", input: {} }]),
        user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
        error(),
      ],
      { kind: "nudge", text: HANDOFF_NUDGE },
    ],
    [
      "dangling user message with no error entry (a host retry inside the kill window)",
      [user(PROMPT), error(), user("try again")],
      { kind: "verbatim", text: "try again" },
    ],
    [
      "user text followed by a real assistant text",
      [user(PROMPT), assistant([{ type: "text", text: "Done." }])],
      { kind: "nudge", text: HANDOFF_NUDGE },
    ],
    [
      "user text as all-text blocks",
      [
        user([
          { type: "text", text: "part one " },
          { type: "text", text: "part two" },
        ]),
        error(),
      ],
      { kind: "verbatim", text: "part one part two" },
    ],
    [
      "synthetic isMeta entries after the user text do not count",
      [
        user(PROMPT),
        error(),
        user("Continue from where you left off.", { isMeta: true }),
        assistant([{ type: "text", text: "No response requested." }], { isMeta: true }),
      ],
      { kind: "verbatim", text: PROMPT },
    ],
    [
      "earlier turns answered, the last one walled",
      [user("first"), assistant([{ type: "text", text: "hi" }]), user(PROMPT), error()],
      { kind: "verbatim", text: PROMPT },
    ],
    [
      "a tool_result alone is not user text",
      [user([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]), error()],
      { kind: "nudge", text: HANDOFF_NUDGE },
    ],
    ["a blank user text falls back to the nudge", [user("   "), error()], { kind: "nudge", text: HANDOFF_NUDGE }],
    ["empty transcript", [], { kind: "nudge", text: HANDOFF_NUDGE }],
  ];
  for (const [name, entries, expected] of cases) {
    test(name, () => {
      expect(resendFor(jsonl(entries))).toEqual(expected);
    });
  }

  test("a missing transcript is the nudge", () => {
    expect(resendFor(null)).toEqual({ kind: "nudge", text: HANDOFF_NUDGE });
    expect(resendFor(undefined)).toEqual({ kind: "nudge", text: HANDOFF_NUDGE });
  });

  test("takes the raw file text and skips a torn last line", () => {
    const text = `${jsonl([user(PROMPT), error()]).join("\n")}\n{"type":"assis`;
    expect(resendFor(text)).toEqual({ kind: "verbatim", text: PROMPT });
  });

  test("the nudge is the fixed sentence", () => {
    expect(HANDOFF_NUDGE).toBe("Continue from where you left off. The previous attempt stopped at a usage limit.");
  });
});

describe("userText", () => {
  test("string, all-text blocks, and not a tool_result", () => {
    expect(userText("hi")).toBe("hi");
    expect(
      userText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
    expect(
      userText([
        { type: "text", text: "a" },
        { type: "tool_result", tool_use_id: "x", content: "y" },
      ]),
    ).toBeNull();
    expect(userText([])).toBeNull();
    expect(userText(undefined)).toBeNull();
  });
});
