import { getGateResult, getThrottleStatus, resetOperatorStats } from "../src/approvalGates.js";

describe("MVP Blocker: Approval gate operatorId validation", () => {
  beforeEach(() => {
    // Reset stats for clean state
    resetOperatorStats("anonymous");
    resetOperatorStats("op-1");
  });

  test("empty operatorId still tracks under 'anonymous'", () => {
    getGateResult("rm -rf /", "");
    getGateResult("rm -rf /home", "");
    getGateResult("rm -rf /tmp", "");

    // Should be throttled even with empty operatorId
    const status = getThrottleStatus("anonymous");
    expect(status.blockCount).toBe(3);
    expect(status.throttled).toBe(true);
  });

  test("undefined operatorId still tracks under 'anonymous'", () => {
    getGateResult("rm -rf /", undefined);
    getGateResult("rm -rf /home", undefined);
    getGateResult("rm -rf /tmp", undefined);

    const status = getThrottleStatus("anonymous");
    expect(status.blockCount).toBe(3);
    expect(status.throttled).toBe(true);
  });

  test("valid operatorId tracks normally", () => {
    getGateResult("rm -rf /", "op-1");
    getGateResult("rm -rf /home", "op-1");
    getGateResult("rm -rf /tmp", "op-1");

    const status = getThrottleStatus("op-1");
    expect(status.blockCount).toBe(3);
    expect(status.throttled).toBe(true);
  });

  test("whitespace-only operatorId treated as anonymous", () => {
    getGateResult("rm -rf /", "   ");

    const status = getThrottleStatus("anonymous");
    expect(status.blockCount).toBe(1);
  });
});
