// The pure half of Limit recording: what a StopFailure payload says about the
// Limit, and which Window a Reading gets the blame.
import { describe, expect, test } from "bun:test";
import { limitFromSignal, windowBlamed, windowFromWallText } from "../src/limit.ts";
import { body, iso, H, record } from "./harness/records.ts";

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
  test("reportedAt is when the hook received it, the session id and Window come from the payload, no Reset", () => {
    const payload = { session_id: "s-9", hook_event_name: "StopFailure", error: "rate_limit", last_assistant_message: "You've hit your session limit · resets 3:45pm" };
    expect(limitFromSignal(payload, iso(0))).toEqual({ reportedAt: iso(0), sessionId: "s-9", window: "five_hour", resetsAt: null });
  });
  test("a payload with no session id takes the tracked one", () => {
    expect(limitFromSignal({ error: "rate_limit" }, iso(0), "tracked").sessionId).toBe("tracked");
  });
  test("an agent_id makes no difference", () => {
    const l = limitFromSignal({ session_id: "s", agent_id: "a1", error: "rate_limit", last_assistant_message: "You've hit your Opus limit" }, iso(0));
    expect(l.window).toBe("Opus");
  });
});

describe("windowBlamed", () => {
  test("the named Window when the Reading carries it", () => {
    const r = record({ id: "a", body: body({ session: 100, week: 100, scoped: [["Opus", 100]] }) });
    expect(windowBlamed(r, "seven_day")!.name).toBe("seven_day");
    expect(windowBlamed(r, "opus")!.name).toBe("Opus");
  });
  test("else the Window reading 100", () => {
    const r = record({ id: "a", body: body({ session: 30, week: 100 }) });
    expect(windowBlamed(r, null)!.name).toBe("seven_day");
    expect(windowBlamed(r, "Haiku")!.name).toBe("seven_day");
  });
  test("else the highest", () => {
    const r = record({ id: "a", body: body({ session: 30, week: 80, sessionReset: iso(H), weekReset: iso(48 * H) }) });
    const w = windowBlamed(r, null)!;
    expect(w.name).toBe("seven_day");
    expect(w.resetsAt).toBe(iso(48 * H));
  });
  test("null with no evident Window", () => {
    expect(windowBlamed(record({ id: "a", body: null }), null)).toBeNull();
    expect(windowBlamed(record({ id: "a", body: body({ sessionReset: null, weekReset: null }) }), null)).toBeNull();
  });
});
