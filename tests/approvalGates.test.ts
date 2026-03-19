/**
 * tests/approvalGates.test.ts — unit tests for pattern matching in approvalGates.ts
 */
import {
  getGateResult,
  getThrottleStatus,
  resetOperatorStats,
  getSteeringStats,
  DEFAULT_BLOCK_PATTERNS,
  DEFAULT_WARN_PATTERNS,
  DEFAULT_LOG_PATTERNS,
} from "../src/approvalGates.js";

// Reset stats between tests to avoid bleed-through
afterEach(() => {
  // Reset any operator that may have been touched
  resetOperatorStats("op-test");
});

describe("DEFAULT_BLOCK_PATTERNS", () => {
  test("rm -rf matches", () => {
    expect(DEFAULT_BLOCK_PATTERNS.some((r) => r.test("rm -rf /"))).toBe(true);
  });

  test("format c: matches", () => {
    expect(DEFAULT_BLOCK_PATTERNS.some((r) => r.test("format c:"))).toBe(true);
  });

  test("rmdir /s matches", () => {
    expect(DEFAULT_BLOCK_PATTERNS.some((r) => r.test("rmdir /s /q temp"))).toBe(true);
  });

  test("del /f /s /q matches", () => {
    expect(DEFAULT_BLOCK_PATTERNS.some((r) => r.test("del /f /s /q path"))).toBe(true);
  });
});

describe("DEFAULT_WARN_PATTERNS", () => {
  test("reset --hard matches", () => {
    expect(DEFAULT_WARN_PATTERNS.some((r) => r.test("git reset --hard HEAD"))).toBe(true);
  });

  test("force push matches", () => {
    expect(DEFAULT_WARN_PATTERNS.some((r) => r.test("force push to remote"))).toBe(true);
  });

  test("push --force matches", () => {
    expect(DEFAULT_WARN_PATTERNS.some((r) => r.test("git push --force origin"))).toBe(true);
  });

  test("drop database matches", () => {
    expect(DEFAULT_WARN_PATTERNS.some((r) => r.test("drop database mydb"))).toBe(true);
  });
});

describe("DEFAULT_LOG_PATTERNS", () => {
  test("npm publish matches", () => {
    expect(DEFAULT_LOG_PATTERNS.some((r) => r.test("npm publish"))).toBe(true);
  });

  test("git push matches", () => {
    expect(DEFAULT_LOG_PATTERNS.some((r) => r.test("git push origin main"))).toBe(true);
  });

  test("sudo matches", () => {
    expect(DEFAULT_LOG_PATTERNS.some((r) => r.test("sudo apt-get install"))).toBe(true);
  });
});

describe("getGateResult", () => {
  test("safe text → allow", () => {
    const result = getGateResult("write a function to sort an array");
    expect(result.action).toBe("allow");
  });

  test("rm -rf → block", () => {
    const result = getGateResult("rm -rf /tmp/test");
    expect(result.action).toBe("block");
    expect(result.pattern).toBeDefined();
  });

  test("force push → warn", () => {
    const result = getGateResult("git push --force origin main");
    expect(result.action).toBe("warn");
  });

  test("hard reset → warn", () => {
    const result = getGateResult("git reset --hard HEAD~3");
    expect(result.action).toBe("warn");
  });

  test("git push → log", () => {
    const result = getGateResult("git push origin feature-branch");
    expect(result.action).toBe("log");
  });

  test("npm publish → log", () => {
    const result = getGateResult("npm publish --access public");
    expect(result.action).toBe("log");
  });

  test("block has higher priority than warn", () => {
    // text has both block and warn keywords
    const result = getGateResult("rm -rf and then hard reset");
    expect(result.action).toBe("block");
  });

  test("warn has higher priority than log", () => {
    // text has both warn and log keywords
    const result = getGateResult("git push --force and npm publish");
    expect(result.action).toBe("warn");
  });

  test("operatorId is tracked in stats", () => {
    resetOperatorStats("op-test");
    getGateResult("rm -rf /tmp", "op-test");
    const status = getThrottleStatus("op-test");
    expect(status.blockCount).toBeGreaterThan(0);
  });

  test("result includes reason on block", () => {
    const result = getGateResult("rm -rf /");
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("blocked");
  });
});

describe("getThrottleStatus", () => {
  test("unknown operator → not throttled", () => {
    const status = getThrottleStatus("nonexistent-op-xyz");
    expect(status.throttled).toBe(false);
    expect(status.blockCount).toBe(0);
    expect(status.warnCount).toBe(0);
  });

  test("3 blocks → throttled", () => {
    resetOperatorStats("op-block-test");
    getGateResult("rm -rf /a", "op-block-test");
    getGateResult("rm -rf /b", "op-block-test");
    getGateResult("rm -rf /c", "op-block-test");
    const status = getThrottleStatus("op-block-test");
    expect(status.throttled).toBe(true);
    expect(status.blockCount).toBe(3);
    resetOperatorStats("op-block-test");
  });

  test("5 warns → throttled", () => {
    resetOperatorStats("op-warn-test");
    for (let i = 0; i < 5; i++) {
      getGateResult("git reset --hard HEAD", "op-warn-test");
    }
    const status = getThrottleStatus("op-warn-test");
    expect(status.throttled).toBe(true);
    expect(status.warnCount).toBe(5);
    resetOperatorStats("op-warn-test");
  });
});

describe("resetOperatorStats", () => {
  test("resets block count", () => {
    getGateResult("rm -rf /tmp", "op-reset-test");
    resetOperatorStats("op-reset-test");
    const status = getThrottleStatus("op-reset-test");
    expect(status.blockCount).toBe(0);
    expect(status.throttled).toBe(false);
  });
});
