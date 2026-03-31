import { jest } from "@jest/globals";

// Mock tts.ts before importing tangentFlow
jest.unstable_mockModule("../src/tts.js", () => ({
  speak: jest.fn(),
}));

// Mock config.ts — default: auto-confirm enabled
const mockGetConfig = jest.fn<(key: string) => unknown>().mockImplementation((key: string) => {
  if (key === "agents.tangentAutoConfirm") return true;
  if (key === "agents.tangentConfirmationTimeout") return 5000;
  return undefined;
});

jest.unstable_mockModule("../src/config.js", () => ({
  getConfig: mockGetConfig,
}));

const { confirmTangentAgent, resolvePendingTangentConfirm, hasPendingTangentConfirm } =
  await import("../src/tangentFlow.js");

import type { OperatorContext } from "../src/operatorRegistry.js";

function makeOp(overrides: Partial<OperatorContext> = {}): OperatorContext {
  return {
    id: "test-op-id",
    name: "TestBot",
    voice: undefined,
    task: "test task",
    status: "active",
    createdAt: Date.now(),
    memory: [],
    visibility: "shared",
    depth: 0,
    permissionPreset: "standard",
    ...overrides,
  };
}

describe("confirmTangentAgent", () => {
  beforeEach(() => {
    mockGetConfig.mockImplementation((key: string) => {
      if (key === "agents.tangentAutoConfirm") return true;
      if (key === "agents.tangentConfirmationTimeout") return 5000;
      return undefined;
    });
  });

  it("auto-confirms when config says tangentAutoConfirm is true", async () => {
    const op = makeOp({ name: "Alpha" });
    const result = await confirmTangentAgent(op, "write tests");
    expect(result.confirmed).toBe(true);
    if (result.confirmed) {
      expect(result.task).toBe("write tests");
    }
  });

  it("auto-confirm preserves exact task text", async () => {
    const op = makeOp({ name: "Beta" });
    const result = await confirmTangentAgent(op, "refactor the auth module completely");
    expect(result.confirmed).toBe(true);
    if (result.confirmed) {
      expect(result.task).toBe("refactor the auth module completely");
    }
  });

  it("auto-confirm works with empty task", async () => {
    const op = makeOp({ name: "Gamma" });
    const result = await confirmTangentAgent(op, "");
    expect(result.confirmed).toBe(true);
    if (result.confirmed) {
      expect(result.task).toBe("");
    }
  });
});

describe("resolvePendingTangentConfirm", () => {
  it("returns false when no pending confirmation", () => {
    expect(resolvePendingTangentConfirm()).toBe(false);
  });
});

describe("hasPendingTangentConfirm", () => {
  it("returns false when no pending confirmation", () => {
    expect(hasPendingTangentConfirm()).toBe(false);
  });
});
