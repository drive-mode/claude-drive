/**
 * tests/sdkMockHelper.test.ts — smoke tests for the shared SDK-mock helper.
 *
 * These don't import any src/ code; they only verify that the helper's
 * utility functions behave sensibly.
 */
import { makeQueryStream, resultMessage, typicalRun } from "./_helpers/sdkMock.js";

describe("sdkMock helpers", () => {
  test("makeQueryStream yields events in order", async () => {
    const events = ["a", "b", "c"];
    const stream = makeQueryStream(events);
    const seen: unknown[] = [];
    for await (const ev of stream) seen.push(ev);
    expect(seen).toEqual(events);
  });

  test("resultMessage returns a canonical success result by default", () => {
    const m = resultMessage() as { type: string; is_error: boolean; result: string; num_turns: number };
    expect(m.type).toBe("result");
    expect(m.is_error).toBe(false);
    expect(m.result).toBe("ok");
    expect(m.num_turns).toBe(0);
  });

  test("resultMessage merges partial overrides", () => {
    const m = resultMessage({ total_cost_usd: 1.5, is_error: true }) as {
      total_cost_usd: number;
      is_error: boolean;
    };
    expect(m.total_cost_usd).toBe(1.5);
    expect(m.is_error).toBe(true);
  });

  test("typicalRun produces init → status → task_started → task_progress → result", () => {
    const r = typicalRun("my summary") as Array<{ type: string; subtype?: string; summary?: string; is_error?: boolean }>;
    expect(r[0]).toMatchObject({ type: "system", subtype: "init" });
    expect(r[1]).toMatchObject({ type: "system", subtype: "status" });
    expect(r[2]).toMatchObject({ type: "system", subtype: "task_started" });
    expect(r[3]).toMatchObject({ type: "system", subtype: "task_progress", summary: "my summary" });
    expect(r[4]).toMatchObject({ type: "result", is_error: false });
  });
});
