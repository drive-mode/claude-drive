/**
 * tests/contextUsage.test.ts — context-usage tracking on OperatorContext.
 * The SDK's Query.getContextUsage() is streaming-only; runOperator attempts
 * it best-effort. These tests exercise the registry setter and the attempted
 * fetch when the query handle exposes getContextUsage on the iterator.
 */
import { jest } from "@jest/globals";
import { installSdkMock } from "./_helpers/sdkMock.js";

const { queryMock: sdkQueryMock } = installSdkMock();

jest.unstable_mockModule("../src/tts.js", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

let runOperator: typeof import("../src/operatorManager.js").runOperator;
let __resetStartupPromise: typeof import("../src/operatorManager.js").__resetStartupPromise;
let OperatorRegistry: typeof import("../src/operatorRegistry.js").OperatorRegistry;

beforeAll(async () => {
  ({ runOperator, __resetStartupPromise } = await import("../src/operatorManager.js"));
  ({ OperatorRegistry } = await import("../src/operatorRegistry.js"));
});

beforeEach(() => {
  sdkQueryMock.mockReset();
  __resetStartupPromise();
});

describe("context usage tracking", () => {
  test("registry.updateContextUsage stores a snapshot", () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("cu");
    reg.updateContextUsage(op.id, {
      total: 500,
      maxTokens: 10000,
      percentage: 5,
      byCategory: { system: 100, tools: 200, messages: 200 },
      updatedAt: 1,
    });
    expect(op.contextUsage?.total).toBe(500);
    expect(op.contextUsage?.byCategory.tools).toBe(200);
    expect(op.contextUsage?.percentage).toBe(5);
  });

  test("runOperator calls getContextUsage when exposed on the query iterator", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("cu2");

    async function* stream() {
      yield { type: "system", subtype: "init", session_id: "sid" };
      yield {
        type: "result",
        is_error: false,
        result: "ok",
        total_cost_usd: 0,
        duration_ms: 1,
        duration_api_ms: 0,
        num_turns: 1,
      };
    }
    // Simulate the Query handle: an async iterator with getContextUsage attached.
    const iterator = Object.assign(stream(), {
      async getContextUsage() {
        return {
          categories: [
            { name: "system", tokens: 42 },
            { name: "messages", tokens: 100 },
          ],
          totalTokens: 142,
          maxTokens: 1000,
          percentage: 14.2,
        };
      },
    });
    sdkQueryMock.mockImplementation(() => iterator);

    await runOperator(op, "t", { allOperators: [], registry: reg });
    expect(op.contextUsage).toBeDefined();
    expect(op.contextUsage?.total).toBe(142);
    expect(op.contextUsage?.byCategory.system).toBe(42);
  });

  test("no context usage is stored when the iterator does not expose it", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("cu3");
    async function* stream() {
      yield { type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 0, duration_api_ms: 0, num_turns: 0 };
    }
    sdkQueryMock.mockImplementation(() => stream());
    await runOperator(op, "t", { allOperators: [], registry: reg });
    expect(op.contextUsage).toBeUndefined();
  });

  test("getContextUsage errors are swallowed (non-streaming mode)", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("cu4");
    async function* stream() {
      yield { type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 0, duration_api_ms: 0, num_turns: 0 };
    }
    const iterator = Object.assign(stream(), {
      async getContextUsage(): Promise<never> { throw new Error("not streaming"); },
    });
    sdkQueryMock.mockImplementation(() => iterator);
    await expect(runOperator(op, "t", { allOperators: [], registry: reg })).resolves.toBeUndefined();
    expect(op.contextUsage).toBeUndefined();
  });
});
