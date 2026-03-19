import { jest } from "@jest/globals";
import { GitService, parseWorktreeListPorcelain } from "../src/gitService.js";
import type { ExecFn } from "../src/gitService.js";

function mockExec(stdout = "", stderr = ""): jest.Mock<ExecFn> {
  return (jest.fn() as jest.Mock<ExecFn>).mockResolvedValue({ stdout, stderr });
}

function failExec(message: string, stderr = ""): jest.Mock<ExecFn> {
  return (jest.fn() as jest.Mock<ExecFn>).mockRejectedValue({ message, stderr });
}

describe("GitService", () => {
  describe("worktreeAdd()", () => {
    it("calls git worktree add with path and branch", async () => {
      const exec = mockExec();
      const git = new GitService("/repo", exec);

      const result = await git.worktreeAdd("/repo/.drive/wt/alpha", "drive/op/alpha");

      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "/repo/.drive/wt/alpha", "drive/op/alpha"],
        { cwd: "/repo" }
      );
    });

    it("returns failure when git errors", async () => {
      const exec = failExec("worktree add failed", "fatal: ...");
      const git = new GitService("/repo", exec);

      const result = await git.worktreeAdd("/repo/.drive/wt/alpha", "drive/op/alpha");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("worktree add failed");
      expect(result.stderr).toBe("fatal: ...");
    });
  });

  describe("worktreeRemove()", () => {
    it("calls git worktree remove with --force", async () => {
      const exec = mockExec();
      const git = new GitService("/repo", exec);

      const result = await git.worktreeRemove("/repo/.drive/wt/alpha");

      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "/repo/.drive/wt/alpha", "--force"],
        { cwd: "/repo" }
      );
    });

    it("returns failure on error", async () => {
      const exec = failExec("not a worktree");
      const git = new GitService("/repo", exec);

      const result = await git.worktreeRemove("/nonexistent");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("not a worktree");
    });
  });

  describe("worktreeList()", () => {
    it("parses porcelain output into entries", async () => {
      const porcelain = [
        "worktree /home/user/repo",
        "HEAD abc1234",
        "branch refs/heads/main",
        "",
        "worktree /home/user/repo/.drive/wt/alpha",
        "HEAD def5678",
        "branch refs/heads/drive/op/alpha",
        "",
      ].join("\n");

      const exec = mockExec(porcelain);
      const git = new GitService("/repo", exec);

      const result = await git.worktreeList();

      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0]).toEqual({
        path: "/home/user/repo",
        branch: "main",
        head: "abc1234",
      });
      expect(result.data![1]).toEqual({
        path: "/home/user/repo/.drive/wt/alpha",
        branch: "drive/op/alpha",
        head: "def5678",
      });
    });

    it("returns empty array for empty output", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.worktreeList();

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe("mergeNoFf()", () => {
    it("merges and returns the new HEAD hash", async () => {
      const exec = mockExec();
      // mergeNoFf calls merge then revParse, so we need two responses
      exec
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // merge --no-ff
        .mockResolvedValueOnce({ stdout: "abc123\n", stderr: "" }); // rev-parse HEAD

      const git = new GitService("/repo", exec);
      const result = await git.mergeNoFf("drive/op/alpha");

      expect(result.ok).toBe(true);
      expect(result.data).toBe("abc123");
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["merge", "--no-ff", "drive/op/alpha"],
        { cwd: "/repo" }
      );
    });

    it("returns failure when merge conflicts", async () => {
      const exec = failExec("merge conflict", "CONFLICT (content): ...");
      const git = new GitService("/repo", exec);

      const result = await git.mergeNoFf("drive/op/alpha");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("merge conflict");
    });
  });

  describe("getCurrentBranch()", () => {
    it("returns trimmed branch name", async () => {
      const exec = mockExec("main\n");
      const git = new GitService("/repo", exec);

      const result = await git.getCurrentBranch();

      expect(result.ok).toBe(true);
      expect(result.data).toBe("main");
    });
  });

  describe("isDirty()", () => {
    it("returns true when there are changes", async () => {
      const exec = mockExec(" M src/foo.ts\n");
      const git = new GitService("/repo", exec);

      const result = await git.isDirty();

      expect(result.ok).toBe(true);
      expect(result.data).toBe(true);
    });

    it("returns false when working tree is clean", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.isDirty();

      expect(result.ok).toBe(true);
      expect(result.data).toBe(false);
    });

    it("passes path filter to git status", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      await git.isDirty("src/foo.ts");

      expect(exec).toHaveBeenCalledWith(
        "git",
        ["status", "--porcelain", "--", "src/foo.ts"],
        { cwd: "/repo" }
      );
    });
  });
});

describe("parseWorktreeListPorcelain()", () => {
  it("strips refs/heads/ prefix from branch", () => {
    const input = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n";
    const entries = parseWorktreeListPorcelain(input);
    expect(entries[0].branch).toBe("main");
  });

  it("handles entries with missing branch (detached HEAD)", () => {
    const input = "worktree /repo\nHEAD abc\n\n";
    const entries = parseWorktreeListPorcelain(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].branch).toBe("");
  });
});
