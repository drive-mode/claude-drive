import { jest } from "@jest/globals";
import { WorktreeManager } from "../src/worktreeManager.js";
import type { GitService, GitResult } from "../src/gitService.js";

function ok<T>(data?: T): GitResult<T> {
  return { ok: true, data: data as T };
}

function fail<T>(error: string): GitResult<T> {
  return { ok: false, error };
}

function createMockGitService() {
  return {
    createBranch: jest.fn<() => Promise<GitResult<void>>>().mockResolvedValue(ok()),
    worktreeAdd: jest.fn<() => Promise<GitResult<void>>>().mockResolvedValue(ok()),
    worktreeRemove: jest.fn<() => Promise<GitResult<void>>>().mockResolvedValue(ok()),
    deleteBranch: jest.fn<() => Promise<GitResult<void>>>().mockResolvedValue(ok()),
  };
}

describe("WorktreeManager", () => {
  let git: ReturnType<typeof createMockGitService>;
  let manager: WorktreeManager;

  beforeEach(() => {
    git = createMockGitService();
    manager = new WorktreeManager(git as unknown as GitService, "/repo");
  });

  describe("allocate()", () => {
    it("creates branch and worktree for new operator", async () => {
      const alloc = await manager.allocate("alpha");

      expect(alloc.operatorId).toBe("alpha");
      expect(alloc.branchName).toBe("drive/op/alpha");
      expect(alloc.worktreePath).toContain("alpha");
      expect(git.createBranch).toHaveBeenCalledWith("drive/op/alpha", "HEAD");
      expect(git.worktreeAdd).toHaveBeenCalledWith(alloc.worktreePath, "drive/op/alpha");
    });

    it("uses custom baseRef", async () => {
      await manager.allocate("alpha", "develop");

      expect(git.createBranch).toHaveBeenCalledWith("drive/op/alpha", "develop");
    });

    it("returns existing allocation on duplicate call (idempotent)", async () => {
      const first = await manager.allocate("alpha");
      const second = await manager.allocate("alpha");

      expect(first).toBe(second);
      expect(git.createBranch).toHaveBeenCalledTimes(1);
    });

    it("throws when branch creation fails", async () => {
      git.createBranch.mockResolvedValue(fail("branch exists"));

      await expect(manager.allocate("alpha")).rejects.toThrow("Failed to create branch");
    });

    it("rolls back branch when worktreeAdd fails", async () => {
      git.worktreeAdd.mockResolvedValue(fail("disk full"));

      await expect(manager.allocate("alpha")).rejects.toThrow("Failed to add worktree");
      expect(git.deleteBranch).toHaveBeenCalledWith("drive/op/alpha");
    });
  });

  describe("release()", () => {
    it("removes worktree and deletes branch", async () => {
      const alloc = await manager.allocate("alpha");
      await manager.release("alpha");

      expect(git.worktreeRemove).toHaveBeenCalledWith(alloc.worktreePath);
      expect(git.deleteBranch).toHaveBeenCalledWith("drive/op/alpha");
    });

    it("no-ops for non-existent operator", async () => {
      await manager.release("ghost");

      expect(git.worktreeRemove).not.toHaveBeenCalled();
      expect(git.deleteBranch).not.toHaveBeenCalled();
    });

    it("clears allocation so re-allocate works", async () => {
      await manager.allocate("alpha");
      await manager.release("alpha");

      expect(manager.getAllocation("alpha")).toBeUndefined();

      const second = await manager.allocate("alpha");
      expect(second.operatorId).toBe("alpha");
      expect(git.createBranch).toHaveBeenCalledTimes(2);
    });
  });

  describe("getAllocation() / listAllocations()", () => {
    it("returns undefined for unknown operator", () => {
      expect(manager.getAllocation("nope")).toBeUndefined();
    });

    it("lists all allocations", async () => {
      await manager.allocate("alpha");
      await manager.allocate("beta");

      const list = manager.listAllocations();
      expect(list).toHaveLength(2);
      expect(list.map((a) => a.operatorId).sort()).toEqual(["alpha", "beta"]);
    });
  });

  describe("cleanup()", () => {
    it("removes allocations not in active set", async () => {
      await manager.allocate("alpha");
      await manager.allocate("beta");
      await manager.allocate("gamma");

      await manager.cleanup(["beta"]);

      expect(manager.getAllocation("alpha")).toBeUndefined();
      expect(manager.getAllocation("beta")).toBeDefined();
      expect(manager.getAllocation("gamma")).toBeUndefined();
      expect(git.worktreeRemove).toHaveBeenCalledTimes(2);
      expect(git.deleteBranch).toHaveBeenCalledTimes(2);
    });

    it("no-ops when all operators are active", async () => {
      await manager.allocate("alpha");
      await manager.cleanup(["alpha"]);

      expect(git.worktreeRemove).not.toHaveBeenCalled();
    });
  });

  describe("mutex serialization", () => {
    it("concurrent allocate calls serialize (no duplicate branches)", async () => {
      const [a, b] = await Promise.all([
        manager.allocate("alpha"),
        manager.allocate("beta"),
      ]);

      expect(a.operatorId).toBe("alpha");
      expect(b.operatorId).toBe("beta");
      expect(git.createBranch).toHaveBeenCalledTimes(2);
    });

    it("concurrent allocate for same operator returns same allocation", async () => {
      const [a, b] = await Promise.all([
        manager.allocate("alpha"),
        manager.allocate("alpha"),
      ]);

      expect(a).toBe(b);
      expect(git.createBranch).toHaveBeenCalledTimes(1);
    });
  });
});
