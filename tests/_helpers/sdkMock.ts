/**
 * tests/_helpers/sdkMock.ts — shared scaffolding for tests that need to stub
 * the @anthropic-ai/claude-agent-sdk module.
 *
 * Usage (at the TOP of a test file, before any src/ import that touches the
 * SDK):
 *
 * ```ts
 * import { jest } from "@jest/globals";
 * import { installSdkMock, makeQueryStream } from "./_helpers/sdkMock.js";
 *
 * const { queryMock, startupMock } = installSdkMock();
 *
 * // ... later, after dynamic imports settle ...
 * queryMock.mockImplementation(() => makeQueryStream([ ... ]));
 * ```
 *
 * The helper does NOT import any src/ modules itself, so it is safe to call
 * before the module-under-test is imported. `installSdkMock()` MUST be
 * invoked at module top level, not inside `beforeAll`, because
 * `jest.unstable_mockModule` only takes effect for subsequent dynamic imports.
 */
import { jest } from "@jest/globals";

export interface SdkMockHandles {
  /** Mock of the SDK's `query()` function. */
  queryMock: jest.Mock;
  /** Mock of the SDK's `startup()` function (default: async noop). */
  startupMock: jest.Mock;
}

export function installSdkMock(): SdkMockHandles {
  const queryMock = jest.fn();
  const startupMock = jest.fn(async () => {
    /* noop */
  });

  jest.unstable_mockModule("@anthropic-ai/claude-agent-sdk", () => ({
    query: queryMock,
    startup: startupMock,
  }));

  return { queryMock, startupMock };
}

/**
 * Build an async-iterator from a canned list of SDK messages. Useful for
 * `queryMock.mockImplementation(() => makeQueryStream([...]))`.
 */
export function makeQueryStream(events: unknown[]): AsyncGenerator<unknown, void, unknown> {
  async function* gen() {
    for (const e of events) yield e;
  }
  return gen();
}

/**
 * Attach helper methods (currently only `getContextUsage`) to an existing
 * stream iterator so tests can exercise control-request code paths on the
 * Query handle.
 */
export function attachQueryHandle<T>(
  iterator: AsyncGenerator<T, void, unknown>,
  handle: Record<string, unknown>,
): AsyncGenerator<T, void, unknown> {
  return Object.assign(iterator, handle) as AsyncGenerator<T, void, unknown>;
}

/**
 * Build a canonical happy-path `result` message for tests that just need the
 * stream to terminate without any side-effects beyond onTaskComplete.
 */
export function resultMessage(partial: Partial<{
  is_error: boolean;
  result: string;
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
}> = {}): unknown {
  return {
    type: "result",
    is_error: partial.is_error ?? false,
    result: partial.result ?? "ok",
    total_cost_usd: partial.total_cost_usd ?? 0,
    duration_ms: partial.duration_ms ?? 0,
    duration_api_ms: partial.duration_api_ms ?? 0,
    num_turns: partial.num_turns ?? 0,
  };
}

/**
 * Common shortcut: init → status → task_started → task_progress → result.
 */
export function typicalRun(summary = "done"): unknown[] {
  return [
    { type: "system", subtype: "init", session_id: "SID" },
    { type: "system", subtype: "status", status: "requesting" },
    { type: "system", subtype: "task_started", task_id: "T", description: "subtask" },
    { type: "system", subtype: "task_progress", task_id: "T", description: "mid", summary,
      usage: { total_tokens: 10, tool_uses: 1, duration_ms: 1 } },
    resultMessage({ total_cost_usd: 0.01, num_turns: 1 }),
  ];
}
