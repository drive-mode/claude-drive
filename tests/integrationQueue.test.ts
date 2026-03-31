import { jest } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { IntegrationQueue } from "../src/integrationQueue.js";
import { StateSyncCoordinator } from "../src/stateSyncCoordinator.js";
import { GitService } from "../src/gitService.js";
import { OperatorRegistry } from "../src/operatorRegistry.js";
import { WorktreeManager } from "../src/worktreeManager.js";
import type { ExecFn } from "../src/gitService.js";
import type { SyncProposal } from "../src/syncTypes.js";

function makeProposal(overrides: Partial<SyncProposal> = {}): SyncProposal {
  return {
    id: "proposal-1",
    operatorId: "op-1",
    operatorName: "Alpha",
    baseCommit: "base000",
    headCommit: "head111",
    changedFiles: ["src/file.ts"],
    conflictingFiles: [],
    status: "approved",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("IntegrationQueue", () => {
  let tmpDir: string;
  let gitService: GitService;
  let registry: OperatorRegistry;
  let worktreeManager: WorktreeManager;
  let coordinator: StateSyncCoordinator;
  let queue: IntegrationQueue;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "intqueue-test-"));

    const exec: ExecFn = async (_cmd, args, _opts) => {
      const sub = args[0];
      if (sub === "rev-parse" && args[1] === "--abbrev-ref") {
        return { stdout: "main\n", stderr: "" };
      }
      if (sub === "rev-parse") {
        return { stdout: "abc123\n", stderr: "" };
      }
      if (sub === "merge" && args[1] === "--no-ff") {
        return { stdout: "", stderr: "" };
      }
      if (sub === "status") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    gitService = new GitService(tmpDir, exec);
    registry = new OperatorRegistry();
    worktreeManager = new WorktreeManager(gitService, tmpDir);
    coordinator = new StateSyncCoordinator(gitService, registry, worktreeManager, tmpDir);
    queue = new IntegrationQueue(gitService, coordinator, registry);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("enqueue()", () => {
    it("adds an item to the queue", () => {
      expect(queue.length()).toBe(0);
      queue.enqueue(makeProposal());
      expect(queue.length()).toBe(1);
    });

    it("adds multiple items to the queue", () => {
      queue.enqueue(makeProposal({ id: "p-1" }));
      queue.enqueue(makeProposal({ id: "p-2" }));
      queue.enqueue(makeProposal({ id: "p-3" }));
      expect(queue.length()).toBe(3);
    });
  });

  describe("processNext()", () => {
    it("returns undefined when queue is empty", async () => {
      const result = await queue.processNext();
      expect(result).toBeUndefined();
    });

    it("processes the oldest item first (FIFO)", async () => {
      // Spawn operators with branch names so applyProposal can find them
      const op1 = registry.spawn("Alpha", "task1");
      op1.branchName = "drive/op/op-1";
      const op2 = registry.spawn("Beta", "task2");
      op2.branchName = "drive/op/op-2";

      queue.enqueue(makeProposal({ id: "p-1", operatorId: op1.id, operatorName: "Alpha" }));
      queue.enqueue(makeProposal({ id: "p-2", operatorId: op2.id, operatorName: "Beta" }));

      const result = await queue.processNext();
      expect(result).toBeDefined();
      expect(result!.proposalId).toBe("p-1");
      expect(queue.length()).toBe(1);
    });

    it("returns success when operator has a branch and merge succeeds", async () => {
      const op = registry.spawn("Alpha", "implement");
      op.branchName = "drive/op/alpha";

      queue.enqueue(makeProposal({ id: "p-1", operatorId: op.id }));

      const result = await queue.processNext();
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.mergeCommit).toBe("abc123");
    });

    it("returns failure when operator has no branch", async () => {
      const op = registry.spawn("Alpha", "implement");
      // Don't set branchName — applyProposal should fail

      queue.enqueue(makeProposal({ id: "p-1", operatorId: op.id }));

      const result = await queue.processNext();
      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error).toBeDefined();
    });
  });

  describe("FIFO ordering", () => {
    it("processes items in order", async () => {
      const op1 = registry.spawn("Alpha", "task1");
      op1.branchName = "drive/op/alpha";
      const op2 = registry.spawn("Beta", "task2");
      op2.branchName = "drive/op/beta";

      queue.enqueue(makeProposal({ id: "first", operatorId: op1.id }));
      queue.enqueue(makeProposal({ id: "second", operatorId: op2.id }));

      const r1 = await queue.processNext();
      const r2 = await queue.processNext();

      expect(r1!.proposalId).toBe("first");
      expect(r2!.proposalId).toBe("second");
    });
  });

  describe("length()", () => {
    it("returns 0 for empty queue", () => {
      expect(queue.length()).toBe(0);
    });

    it("decrements after processNext", async () => {
      const op = registry.spawn("Alpha", "task");
      op.branchName = "drive/op/alpha";

      queue.enqueue(makeProposal({ id: "p-1", operatorId: op.id }));
      expect(queue.length()).toBe(1);

      await queue.processNext();
      expect(queue.length()).toBe(0);
    });
  });

  describe("clear()", () => {
    it("empties the queue without processing", () => {
      queue.enqueue(makeProposal({ id: "p-1" }));
      queue.enqueue(makeProposal({ id: "p-2" }));
      expect(queue.length()).toBe(2);

      queue.clear();
      expect(queue.length()).toBe(0);
    });
  });

  describe("processAll()", () => {
    it("returns empty array for empty queue", async () => {
      const results = await queue.processAll();
      expect(results).toEqual([]);
    });

    it("processes all items sequentially", async () => {
      const op1 = registry.spawn("Alpha", "task1");
      op1.branchName = "drive/op/alpha";
      const op2 = registry.spawn("Beta", "task2");
      op2.branchName = "drive/op/beta";

      queue.enqueue(makeProposal({ id: "p-1", operatorId: op1.id }));
      queue.enqueue(makeProposal({ id: "p-2", operatorId: op2.id }));

      const results = await queue.processAll();
      expect(results).toHaveLength(2);
      expect(results[0].proposalId).toBe("p-1");
      expect(results[1].proposalId).toBe("p-2");
    });
  });
});
