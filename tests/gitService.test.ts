import { jest } from "@jest/globals";
import { GitService, parseWorktreeListPorcelain } from "../src/gitService.js";
import type { ExecFn } from "../src/gitService.js";

/** Helper: create a mock exec that resolves with given stdout. */
function mockExec(stdout = "", stderr = ""): jest.Mock<ExecFn> {
  return jest.fn<ExecFn>().mockResolvedValue({ stdout, stderr });
}

/** Helper: create a mock exec that rejects with an error. */
function failExec(message = "git error", stderr = "fatal"): jest.Mock<ExecFn> {
  return jest.fn<ExecFn>().mockRejectedValue(
    Object.assign(new Error(message), { stderr })
  );
}

describe("GitService", () => {
  describe("getCurrentBranch()", () => {
    it("returns trimmed branch name on success", async () => {
      const exec = mockExec("main\n");
      const git = new GitService("/repo", exec);

      const result = await git.getCurrentBranch();
      expect(result.ok).toBe(true);
      expect(result.data).toBe("main");
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: "/repo" }
      );
    });

    it("returns failure on git error", async () => {
      const exec = failExec("not a git repository");
      const git = new GitService("/repo", exec);

      const result = await git.getCurrentBranch();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not a git repository");
      expect(result.stderr).toBe("fatal");
    });
  });

  describe("getRepoRoot()", () => {
    it("returns trimmed repo root path", async () => {
      const exec = mockExec("/home/user/project\n");
      const git = new GitService("/repo", exec);

      const result = await git.getRepoRoot();
      expect(result.ok).toBe(true);
      expect(result.data).toBe("/home/user/project");
    });
  });

  describe("revParse()", () => {
    it("resolves a ref to a commit hash", async () => {
      const exec = mockExec("abc123def456\n");
      const git = new GitService("/repo", exec);

      const result = await git.revParse("HEAD");
      expect(result.ok).toBe(true);
      expect(result.data).toBe("abc123def456");
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: "/repo" }
      );
    });
  });

  describe("getMergeBase()", () => {
    it("returns merge base commit", async () => {
      const exec = mockExec("deadbeef\n");
      const git = new GitService("/repo", exec);

      const result = await git.getMergeBase("main", "feature");
      expect(result.ok).toBe(true);
      expect(result.data).toBe("deadbeef");
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["merge-base", "main", "feature"],
        { cwd: "/repo" }
      );
    });
  });

  describe("listChangedFiles()", () => {
    it("returns list of changed files", async () => {
      const exec = mockExec("src/a.ts\nsrc/b.ts\n");
      const git = new GitService("/repo", exec);

      const result = await git.listChangedFiles("abc", "def");
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("returns empty array when no files changed", async () => {
      const exec = mockExec("\n");
      const git = new GitService("/repo", exec);

      const result = await git.listChangedFiles("abc", "def");
      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe("isDirty()", () => {
    it("returns true when working tree has changes", async () => {
      const exec = mockExec(" M src/file.ts\n");
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

    it("passes path filter when provided", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      await git.isDirty("src/");
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["status", "--porcelain", "--", "src/"],
        { cwd: "/repo" }
      );
    });
  });

  describe("createBranch()", () => {
    it("calls git branch with correct args", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.createBranch("feature/new", "main");
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["branch", "feature/new", "main"],
        { cwd: "/repo" }
      );
    });

    it("returns failure when branch creation fails", async () => {
      const exec = failExec("branch already exists");
      const git = new GitService("/repo", exec);

      const result = await git.createBranch("existing", "main");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("branch already exists");
    });
  });

  describe("mergeNoFf()", () => {
    it("calls git merge --no-ff then returns HEAD hash", async () => {
      let callCount = 0;
      const exec = jest.fn<ExecFn>().mockImplementation(async (_cmd, args) => {
        callCount++;
        if (args[0] === "merge") {
          return { stdout: "", stderr: "" };
        }
        // rev-parse HEAD
        return { stdout: "mergecommit123\n", stderr: "" };
      });
      const git = new GitService("/repo", exec);

      const result = await git.mergeNoFf("feature/branch");
      expect(result.ok).toBe(true);
      expect(result.data).toBe("mergecommit123");
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["merge", "--no-ff", "feature/branch"],
        { cwd: "/repo" }
      );
    });

    it("returns failure when merge fails", async () => {
      const exec = failExec("merge conflict");
      const git = new GitService("/repo", exec);

      const result = await git.mergeNoFf("conflicting");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("merge conflict");
    });
  });

  describe("worktreeAdd()", () => {
    it("calls git worktree add with path and branch", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.worktreeAdd("/repo/.drive/wt/op1", "drive/op/op1");
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "/repo/.drive/wt/op1", "drive/op/op1"],
        { cwd: "/repo" }
      );
    });
  });

  describe("worktreeRemove()", () => {
    it("calls git worktree remove --force", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.worktreeRemove("/repo/.drive/wt/op1");
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "/repo/.drive/wt/op1", "--force"],
        { cwd: "/repo" }
      );
    });
  });

  describe("worktreeList()", () => {
    it("parses porcelain output into entries", async () => {
      const porcelain = [
        "worktree /home/user/project",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /home/user/project/.drive/wt/op1",
        "HEAD def456",
        "branch refs/heads/drive/op/op1",
        "",
      ].join("\n");
      const exec = mockExec(porcelain);
      const git = new GitService("/repo", exec);

      const result = await git.worktreeList();
      expect(result.ok).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data![0]).toEqual({
        path: "/home/user/project",
        branch: "main",
        head: "abc123",
      });
      expect(result.data![1]).toEqual({
        path: "/home/user/project/.drive/wt/op1",
        branch: "drive/op/op1",
        head: "def456",
      });
    });
  });

  describe("cherryPick()", () => {
    it("calls git cherry-pick with commit", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.cherryPick("abc123");
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["cherry-pick", "abc123"],
        { cwd: "/repo" }
      );
    });
  });

  describe("abortMerge()", () => {
    it("calls git merge --abort", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.abortMerge();
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["merge", "--abort"],
        { cwd: "/repo" }
      );
    });
  });

  describe("deleteBranch()", () => {
    it("calls git branch -D", async () => {
      const exec = mockExec("");
      const git = new GitService("/repo", exec);

      const result = await git.deleteBranch("old-branch");
      expect(result.ok).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        "git",
        ["branch", "-D", "old-branch"],
        { cwd: "/repo" }
      );
    });
  });
});

describe("parseWorktreeListPorcelain()", () => {
  it("parses standard porcelain output", () => {
    const output = [
      "worktree /repo",
      "HEAD aaa111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.drive/wt/op1",
      "HEAD bbb222",
      "branch refs/heads/drive/op/op1",
      "",
    ].join("\n");

    const entries = parseWorktreeListPorcelain(output);
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("/repo");
    expect(entries[0].branch).toBe("main");
    expect(entries[0].head).toBe("aaa111");
    expect(entries[1].branch).toBe("drive/op/op1");
  });

  it("returns empty array for empty input", () => {
    expect(parseWorktreeListPorcelain("")).toEqual([]);
  });

  it("handles detached HEAD (no branch line)", () => {
    const output = [
      "worktree /repo",
      "HEAD aaa111",
      "detached",
      "",
    ].join("\n");

    const entries = parseWorktreeListPorcelain(output);
    expect(entries).toHaveLength(1);
    expect(entries[0].branch).toBe("");
    expect(entries[0].head).toBe("aaa111");
  });
});
