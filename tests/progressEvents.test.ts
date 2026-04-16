/**
 * tests/progressEvents.test.ts — feeds synthetic SDK messages through a mocked
 * query() generator to exercise runOperator's message-routing branches:
 *
 *   - system/init               → op.sessionId + memory_paths note
 *   - system/status=requesting  → activity log
 *   - system/task_started       → progress event + progress-file write
 *   - system/task_progress      → progress event (with summary) + log + file
 *   - system/memory_recall      → memoryManager import (context entry)
 *   - result                    → onTaskComplete invoked, stats captured
 *
 * Uses jest.unstable_mockModule to stub the SDK.
 */
import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

// Build a synthetic SDK query() that yields a canned event sequence.
function makeQueryStream(events: unknown[]) {
  async function* gen() {
    for (const e of events) yield e;
  }
  return gen();
}

// These are captured at mock-time via closure.
const sdkQueryMock = jest.fn();
const sdkStartupMock = jest.fn(async () => { /* no-op */ });

jest.unstable_mockModule("@anthropic-ai/claude-agent-sdk", () => ({
  query: sdkQueryMock,
  startup: sdkStartupMock,
}));

// Mute TTS so tests don't exec anything.
jest.unstable_mockModule("../src/tts.js", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

let runOperator: typeof import("../src/operatorManager.js").runOperator;
let __resetStartupPromise: typeof import("../src/operatorManager.js").__resetStartupPromise;
let OperatorRegistry: typeof import("../src/operatorRegistry.js").OperatorRegistry;
let readProgressSnapshot: typeof import("../src/progressFile.js").readProgressSnapshot;
let memoryStore: typeof import("../src/memoryStore.js").memoryStore;
let agentOutput: typeof import("../src/agentOutput.js").agentOutput;

beforeAll(async () => {
  ({ runOperator, __resetStartupPromise } = await import("../src/operatorManager.js"));
  ({ OperatorRegistry } = await import("../src/operatorRegistry.js"));
  ({ readProgressSnapshot } = await import("../src/progressFile.js"));
  ({ memoryStore } = await import("../src/memoryStore.js"));
  ({ agentOutput } = await import("../src/agentOutput.js"));
});

beforeEach(() => {
  sdkQueryMock.mockReset();
  sdkStartupMock.mockClear();
  __resetStartupPromise();
  for (const e of memoryStore.getAll()) memoryStore.remove(e.id);
});

function tmpBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cd-progev-"));
}

describe("runOperator message routing", () => {
  test("handles init (session_id + memory_paths), status, task events, and result", async () => {
    const base = tmpBase();
    const reg = new OperatorRegistry();
    const op = reg.spawn("tester");

    const progressEmitted: string[] = [];
    const listener = (ev: { type?: string; summary?: string }) => {
      if (ev.type === "progress") progressEmitted.push(ev.summary ?? "");
    };
    agentOutput.on("event", listener);

    sdkQueryMock.mockImplementation(() => makeQueryStream([
      { type: "system", subtype: "init", session_id: "SID-1", memory_paths: ["/a.md", "/b.md"] },
      { type: "system", subtype: "status", status: "requesting" },
      { type: "system", subtype: "task_started", task_id: "T1", description: "first sub-step" },
      { type: "system", subtype: "task_progress", task_id: "T1", description: "mid", summary: "halfway done", usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 } },
      {
        type: "result",
        is_error: false,
        result: "complete",
        total_cost_usd: 0.123,
        duration_ms: 200,
        duration_api_ms: 120,
        num_turns: 3,
      },
    ]));

    let captured: { cost: number; turns: number } | undefined;
    await runOperator(op, "do a task", {
      allOperators: [],
      registry: reg,
      isBackground: true,
      progressBaseDir: base,
      onTaskComplete: (_o, stats) => { captured = { cost: stats.totalCostUsd, turns: stats.numTurns }; },
    });
    agentOutput.off("event", listener);

    expect(op.sessionId).toBe("SID-1");
    expect(op.memory.some((m) => m.includes("sdk-memory-paths"))).toBe(true);
    expect(progressEmitted).toContain("halfway done");
    expect(captured).toEqual({ cost: 0.123, turns: 3 });

    // Progress file records task_started, task_progress, and result (3 events).
    const snap = readProgressSnapshot(op.id, base);
    expect(snap.events.map((e) => e.type)).toEqual(["task_started", "task_started", "task_progress", "result"]);
    expect(snap.last?.type).toBe("result");

    // Background run marks the operator completed for await() to unblock.
    expect(op.status).toBe("completed");
    expect(sdkStartupMock).toHaveBeenCalledTimes(1);
  });

  test("memory_recall events import context entries", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("mem-op");

    sdkQueryMock.mockImplementation(() => makeQueryStream([
      { type: "system", subtype: "init", session_id: "s" },
      {
        type: "system",
        subtype: "memory_recall",
        mode: "select",
        memories: [
          { path: "/notes/a.md", scope: "personal", content: "remembered alpha" },
          { path: "/notes/b.md", scope: "team" },
        ],
      },
      { type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 0, duration_api_ms: 0, num_turns: 1 },
    ]));

    await runOperator(op, "recall", { allOperators: [], registry: reg });

    const imported = memoryStore.query({ operatorId: op.id, tags: ["sdk-memory"] });
    expect(imported.length).toBe(2);
    expect(imported.some((e) => e.content.includes("remembered alpha"))).toBe(true);
  });

  test("startup() is skipped when operator.preWarm=false", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("no-prewarm");
    const { saveConfig } = await import("../src/config.js");
    saveConfig("operator.preWarm", false);

    sdkQueryMock.mockImplementation(() => makeQueryStream([
      { type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 0, duration_api_ms: 0, num_turns: 0 },
    ]));

    await runOperator(op, "t", { allOperators: [], registry: reg });
    expect(sdkStartupMock).not.toHaveBeenCalled();
    saveConfig("operator.preWarm", true); // reset
  });

  test("rate_limit_event logs without crashing", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("rate");
    sdkQueryMock.mockImplementation(() => makeQueryStream([
      { type: "rate_limit_event", rate_limit_info: { status: "throttled", resetsAt: "now" } },
      { type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 0, duration_api_ms: 0, num_turns: 0 },
    ]));
    await expect(runOperator(op, "t", { allOperators: [], registry: reg })).resolves.toBeUndefined();
  });

  test("taskBudget + effort flow through to query options", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("budgeted");
    sdkQueryMock.mockImplementation(() => makeQueryStream([
      { type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 0, duration_api_ms: 0, num_turns: 0 },
    ]));

    await runOperator(op, "t", {
      allOperators: [],
      registry: reg,
      taskBudget: 50_000,
      effort: "high",
    });

    const call = sdkQueryMock.mock.calls[0]?.[0] as { options?: Record<string, unknown> } | undefined;
    expect(call?.options?.taskBudget).toEqual({ total: 50_000 });
    expect(call?.options?.effort).toBe("high");
    expect(call?.options?.agentProgressSummaries).toBe(true);
  });

  test("background run records error event when query throws", async () => {
    const base = tmpBase();
    const reg = new OperatorRegistry();
    const op = reg.spawn("crasher");

    sdkQueryMock.mockImplementation(() => {
      async function* gen() {
        yield { type: "system", subtype: "init", session_id: "s" };
        throw new Error("boom");
      }
      return gen();
    });

    await expect(
      runOperator(op, "t", { allOperators: [], registry: reg, isBackground: true, progressBaseDir: base }),
    ).rejects.toThrow(/boom/);

    const snap = readProgressSnapshot(op.id, base);
    expect(snap.events.some((e) => e.type === "error")).toBe(true);
    expect(op.status).toBe("completed");
  });
});
