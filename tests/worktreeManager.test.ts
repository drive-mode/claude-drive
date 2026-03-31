import { jest } from "@jest/globals";
import * as path from "path";
import { WorktreeManager } from "../src/worktreeManager.js";
import { GitService } from "../src/gitService.js";
import type { ExecFn, GitResult } from "../src/gitService.js";

/** Create a mock ExecFn that always succeeds. */
function successExec(): jest.Mock<ExecFn> {
  return jest.fn<ExecFn>().mockResolvedValue({ stdout: "", stderr: "" });
}

/** Create a GitService backed by a mock exec for testing. */
function createMockGitService(exec?: jest.Mock<ExecFn>): GitService {
  return new GitService("/repo", exec ?? successExec());
}

describe("WorktreeManager", () => {
  let exec: jest.Mock<ExecFn>;
  let gitService: GitService;
  let manager: WorktreeManager;

  beforeEach(() => {
    exec = successExec();
    gitService = createMockGitService(exec);
    manager = new WorktreeManager(gitService, "/repo");
  });

  describe("allocate()", () => {
    it("creates a worktree allocation with correct branch and path", async () => {
      const allocation = await manager.allocate("op-1");

      expect(allocation.operatorId).toBe("op-1");
      expect(allocation.branchName).toBe("drive/op/op-1");
      expect(allocation.worktreePath).toContain("op-1");
      expect(allocation.worktreePath).toContain(
        path.join(".drive", "worktrees")
      );
    });

    it("calls git branch and git worktree add", async () => {
      await manager.allocate("op-1");

      // First call: git branch drive/op/op-1 HEAD
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["branch", "drive/op/op-1", "HEAD"],
        { cwd: "/repo" }
      );

      // Second call: git worktree add <path> drive/op/op-1
      expect(exec).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add"]),
        { cwd: "/repo" }
      );
    });

    it("uses custom baseRef when provided", async () => {
      await manager.allocate("op-1", "main");

      expect(exec).toHaveBeenCalledWith(
        "git",
        ["branch", "drive/op/op-1", "main"],
        { cwd: "/repo" }
      );
    });

    it("returns existing allocation on duplicate allocate (idempotent)", async () => {
      const first = await manager.allocate("op-1");
      const second = await manager.allocate("op-1");

      expect(first).toBe(second);
      // Branch creation should only happen once
      const branchCalls = exec.mock.calls.filter(
        (call) => call[1][0] === "branch"
      );
      expect(branchCalls.length).toBe(1);
    });

    it("throws when git branch creation fails", async () => {
      exec.mockRejectedValueOnce(
        Object.assign(new Error("branch exists"), { stderr: "fatal" })
      );

      await expect(manager.allocate("op-fail")).rejects.toThrow(
        "Failed to create branch"
      );
    });

    it("rolls back branch on worktree add failure", async () => {
      // First call (branch) succeeds, second call (worktree add) fails
      let callCount = 0;
      exec.mockImplementation(async (_cmd, args) => {
        callCount++;
        if (args[0] === "worktree" && args[1] === "add") {
          throw Object.assign(new Error("worktree failed"), { stderr: "fatal" });
        }
        return { stdout: "", stderr: "" };
      });

      await expect(manager.allocate("op-rollback")).rejects.toThrow(
        "Failed to add worktree"
      );

      // Should have called branch -D to rollback
      const deleteCalls = exec.mock.calls.filter(
        (call) => call[1][0] === "branch" && call[1][1] === "-D"
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0][1]).toContain("drive/op/op-rollback");
    });
  });

  describe("release()", () => {
    it("removes worktree and deletes branch", async () => {
      await manager.allocate("op-1");
      exec.mockClear();

      await manager.release("op-1");

      // Should call worktree remove and branch -D
      expect(exec).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove"]),
        { cwd: "/repo" }
      );
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["branch", "-D", "drive/op/op-1"],
        { cwd: "/repo" }
      );
    });

    it("removes allocation from internal map after release", async () => {
      await manager.allocate("op-1");
      expect(manager.getAllocation("op-1")).toBeDefined();

      await manager.release("op-1");
      expect(manager.getAllocation("op-1")).toBeUndefined();
    });

    it("is a no-op for non-existent allocation", async () => {
      exec.mockClear();
      await manager.release("does-not-exist");
      // No git commands should be called
      expect(exec).not.toHaveBeenCalled();
    });
  });

  describe("getAllocation()", () => {
    it("returns allocation for an allocated operator", async () => {
      await manager.allocate("op-1");
      const alloc = manager.getAllocation("op-1");
      expect(alloc).toBeDefined();
      expect(alloc!.operatorId).toBe("op-1");
      expect(alloc!.branchName).toBe("drive/op/op-1");
    });

    it("returns undefined for unallocated operator", () => {
      expect(manager.getAllocation("nonexistent")).toBeUndefined();
    });
  });

  describe("listAllocations()", () => {
    it("returns empty array when no allocations", () => {
      expect(manager.listAllocations()).toEqual([]);
    });

    it("returns all current allocations", async () => {
      await manager.allocate("op-1");
      await manager.allocate("op-2");

      const list = manager.listAllocations();
      expect(list.length).toBe(2);
      expect(list.map((a) => a.operatorId).sort()).toEqual(["op-1", "op-2"]);
    });

    it("excludes released allocations", async () => {
      await manager.allocate("op-1");
      await manager.allocate("op-2");
      await manager.release("op-1");

      const list = manager.listAllocations();
      expect(list.length).toBe(1);
      expect(list[0].operatorId).toBe("op-2");
    });
  });

  describe("cleanup()", () => {
    it("removes orphaned allocations not in active set", async () => {
      await manager.allocate("op-1");
      await manager.allocate("op-2");
      await manager.allocate("op-3");

      // Only op-2 is still active
      await manager.cleanup(["op-2"]);

      expect(manager.listAllocations().length).toBe(1);
      expect(manager.getAllocation("op-2")).toBeDefined();
      expect(manager.getAllocation("op-1")).toBeUndefined();
      expect(manager.getAllocation("op-3")).toBeUndefined();
    });

    it("is a no-op when all allocations are active", async () => {
      await manager.allocate("op-1");
      await manager.allocate("op-2");
      exec.mockClear();

      await manager.cleanup(["op-1", "op-2"]);

      // No worktree remove or branch delete calls
      const removeCalls = exec.mock.calls.filter(
        (call) => call[1][0] === "worktree" && call[1][1] === "remove"
      );
      expect(removeCalls.length).toBe(0);
      expect(manager.listAllocations().length).toBe(2);
    });
  });

  describe("serialization", () => {
    it("handles concurrent allocate calls safely", async () => {
      // Launch two allocates concurrently
      const [a1, a2] = await Promise.all([
        manager.allocate("op-1"),
        manager.allocate("op-2"),
      ]);

      expect(a1.operatorId).toBe("op-1");
      expect(a2.operatorId).toBe("op-2");
      expect(manager.listAllocations().length).toBe(2);
    });
  });
});
