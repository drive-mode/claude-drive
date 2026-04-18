import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

// Mock runOperator so we don't hit the SDK. The mock simulates completion,
// calls onTaskComplete with stats, and writes a fake progress snapshot.
const mockRunOperator = jest.fn(async (_op: any, _task: string, opts: any) => {
  const i = (opts?.progressBaseDir ? 0 : 0);
  // Use operator-name suffix for deterministic per-run cost/turns
  const m = /(\d+)$/.exec(_op.name as string);
  const idx = m ? parseInt(m[1], 10) : 1;
  const stats = { totalCostUsd: 0.01 * idx, durationMs: 100 + idx, apiDurationMs: 50, numTurns: idx };
  if (opts?.progressBaseDir) {
    const { writeProgressEvent } = await import("../src/progressFile.js");
    writeProgressEvent(_op.id, { type: "task_progress", summary: `run ${idx} summary` }, opts.progressBaseDir);
    writeProgressEvent(_op.id, { type: "result", stats }, opts.progressBaseDir);
  }
  opts?.onTaskComplete?.(_op, stats);
  if (opts?.registry) opts.registry.markStatus(_op.id, "completed");
});

jest.unstable_mockModule("../src/operatorManager.js", () => ({
  runOperator: mockRunOperator,
  // keep other exports if needed — unused by bestOfN
}));

let runBestOfN: typeof import("../src/bestOfN.js").runBestOfN;
let OperatorRegistry: typeof import("../src/operatorRegistry.js").OperatorRegistry;

beforeAll(async () => {
  ({ runBestOfN } = await import("../src/bestOfN.js"));
  ({ OperatorRegistry } = await import("../src/operatorRegistry.js"));
});

beforeEach(() => {
  mockRunOperator.mockClear();
});

function tmpBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cd-bestofn-"));
}

describe("runBestOfN", () => {
  test("spawns N operators in parallel and collects stats", async () => {
    const reg = new OperatorRegistry();
    const base = tmpBase();
    const result = await runBestOfN("do stuff", reg, { count: 3, progressBaseDir: base });
    expect(mockRunOperator).toHaveBeenCalledTimes(3);
    expect(result.all).toHaveLength(3);
    expect(result.all.every((r) => r.success)).toBe(true);
    expect(result.winnerIndex).toBe(0); // lowest cost = bestof-1
  });

  test("default scorer prefers success over cost", async () => {
    const reg = new OperatorRegistry();
    mockRunOperator.mockImplementationOnce(async (op: any, _task: string, opts: any) => {
      throw new Error("boom");
    });
    mockRunOperator.mockImplementationOnce(async (op: any, _task: string, opts: any) => {
      const stats = { totalCostUsd: 0.99, durationMs: 1, apiDurationMs: 0, numTurns: 1 };
      opts?.onTaskComplete?.(op, stats);
      if (opts?.registry) opts.registry.markStatus(op.id, "completed");
    });
    const result = await runBestOfN("t", reg, { count: 2 });
    expect(result.winnerIndex).toBe(1); // #0 failed, #1 succeeded
  });

  test("count is clamped to bestOfN.maxCount", async () => {
    const reg = new OperatorRegistry();
    await runBestOfN("t", reg, { count: 999 });
    // default maxCount is 4
    expect(mockRunOperator).toHaveBeenCalledTimes(4);
  });

  test("honours custom scorer", async () => {
    const reg = new OperatorRegistry();
    const result = await runBestOfN("t", reg, {
      count: 2,
      scorer: () => 1, // always pick second
    });
    expect(result.winnerIndex).toBe(1);
  });

  test("captures lastSummary from progress snapshot", async () => {
    const reg = new OperatorRegistry();
    const base = tmpBase();
    const result = await runBestOfN("t", reg, { count: 1, progressBaseDir: base });
    expect(result.all[0].lastSummary).toContain("summary");
  });

  test("worktreeManager integration allocates per-operator worktrees", async () => {
    const reg = new OperatorRegistry();
    const allocated: Array<{ operatorId: string; worktreePath: string; branchName: string }> = [];
    const fakeWm = {
      allocate: async (operatorId: string, _baseRef: string) => {
        const alloc = { operatorId, worktreePath: `/tmp/wt-${operatorId}`, branchName: `drive/op/${operatorId}` };
        allocated.push(alloc);
        return alloc;
      },
      release: async () => { /* noop */ },
      listAllocations: () => allocated,
    } as unknown as import("../src/worktreeManager.js").WorktreeManager;

    const seenCwds: string[] = [];
    mockRunOperator.mockImplementation(async (op: any, _t: string, o: any) => {
      seenCwds.push(o.cwd);
      o?.onTaskComplete?.(op, { totalCostUsd: 0.1, durationMs: 1, apiDurationMs: 0, numTurns: 1 });
      o?.registry?.markStatus(op.id, "completed");
    });

    const result = await runBestOfN("t", reg, { count: 2, worktreeManager: fakeWm });
    expect(allocated).toHaveLength(2);
    expect(seenCwds).toEqual(expect.arrayContaining(allocated.map((a) => a.worktreePath)));
    // Each operator should have its allocated workspace recorded on the registry.
    for (const r of result.all) {
      const op = reg.findByNameOrId(r.op.id);
      expect(op?.worktreePath).toMatch(/^\/tmp\/wt-/);
      expect(op?.branchName).toMatch(/^drive\/op\//);
    }
  });

  test("warns via activity log when count >= 3", async () => {
    const { agentOutput } = await import("../src/agentOutput.js");
    const reg = new OperatorRegistry();
    const warnings: string[] = [];
    const listener = (ev: { type?: string; agent?: string; text?: string }) => {
      if (ev.type === "activity" && ev.agent === "best-of-n") warnings.push(ev.text ?? "");
    };
    agentOutput.on("event", listener);
    await runBestOfN("t", reg, { count: 3 });
    agentOutput.off("event", listener);
    expect(warnings.some((w) => w.includes("API cost scales"))).toBe(true);
  });
});
