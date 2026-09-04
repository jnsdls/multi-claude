// The pure half of Limit recording: what a StopFailure payload says about the
// Limit, and which Window a Reading gets the blame.
import { describe, expect, test } from "bun:test";
import { limitFromSignal, windowBlamed, windowFromWallText } from "../src/limit.ts";
import { body, H, iso, MIN, NOW, record } from "./harness/records.ts";

describe("windowFromWallText", () => {
  const cases: [string, string | undefined, string | null][] = [
    ["session limit", "You've hit your session limit · resets 3:45pm", "five_hour"],
    ["weekly limit", "You've hit your weekly limit · resets Mon 12:00am", "seven_day"],
    ["Opus limit", "You've hit your Opus limit · resets 3:45pm", "Opus"],
    ["Sonnet limit", "You've hit your Sonnet limit · resets 3:45pm", "Sonnet"],
    ["Fable limit", "You've hit your Fable limit · progress saved", "Fable"],
    ["usage limit is not a Window", "You've hit your usage limit", null],
    ["monthly spend limit is not a Window", "You've hit your monthly spend limit", null],
    ["usage credit limit is not a Window", "You've hit your usage credit limit · run /usage-credits", null],
    ["no text", undefined, null],
    ["unrelated text", "Something else happened", null],
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      expect(windowFromWallText(text)).toBe(expected);
    });
  }
});

describe("limitFromSignal", () => {
  test("reportedAt is when the hook received it, the session id comes from the payload, no Window and no Reset", () => {
    const payload = {
      session_id: "s-9",
      hook_event_name: "StopFailure",
      error: "rate_limit",
      last_assistant_message: "You've hit your session limit · resets 3:45pm",
    };
    expect(limitFromSignal(payload, iso(0))).toEqual({
      reportedAt: iso(0),
      sessionId: "s-9",
      window: null,
      resetsAt: null,
    });
  });
  test("a payload with no session id takes the tracked one", () => {
    expect(limitFromSignal({ error: "rate_limit" }, iso(0), "tracked").sessionId).toBe("tracked");
  });
});

describe("windowBlamed", () => {
  test("the applicable Window reading 100", () => {
    const r = record({ id: "a", body: body({ session: 30, week: 100, scoped: [["Opus", 100]] }) });
    expect(windowBlamed(r, null, NOW)!.name).toBe("seven_day");
    expect(windowBlamed(r, "claude-sonnet-4", NOW)!.name).toBe("seven_day");
    const opus = record({ id: "b", body: body({ session: 30, week: 20, scoped: [["Opus", 100]] }) });
    expect(windowBlamed(opus, "claude-opus-4-1", NOW)!.name).toBe("Opus");
  });
  test("else the highest evident one", () => {
    const r = record({ id: "a", body: body({ session: 30, week: 80, sessionReset: iso(H), weekReset: iso(48 * H) }) });
    const w = windowBlamed(r, null, NOW)!;
    expect(w.name).toBe("seven_day");
    expect(w.resetsAt).toBe(iso(48 * H));
  });
  test("a Window whose Reset passed is not blamed", () => {
    const r = record({ id: "a", body: body({ session: 100, week: 40, sessionReset: iso(-MIN) }) });
    expect(windowBlamed(r, null, NOW)!.name).toBe("seven_day");
  });
  test("null with no evident Window", () => {
    expect(windowBlamed(record({ id: "a", body: null }), null, NOW)).toBeNull();
    expect(
      windowBlamed(record({ id: "a", body: body({ sessionReset: null, weekReset: null }) }), null, NOW),
    ).toBeNull();
  });
});
