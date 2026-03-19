/**
 * Centralized git command wrapper.
 *
 * All git shell calls go through this service — no scattered exec calls
 * elsewhere. Every method returns a typed GitResult<T> with error/stderr
 * on failure. This makes git operations testable via dependency injection
 * and keeps error handling consistent.
 */

import { execFile } from "child_process";

// ── Result type ─────────────────────────────────────────────────────────────

export interface GitResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  stderr?: string;
}

function success<T>(data: T): GitResult<T> {
  return { ok: true, data };
}

function failure<T>(error: string, stderr?: string): GitResult<T> {
  return { ok: false, error, stderr };
}

// ── Worktree list entry ─────────────────────────────────────────────────────

export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
}

// ── Exec helper type (for testing injection) ────────────────────────────────

export type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string }
) => Promise<{ stdout: string; stderr: string }>;

/** Default exec implementation wrapping child_process.execFile. */
function defaultExec(
  cmd: string,
  args: string[],
  opts: { cwd: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout: stdout ?? "", stderr: stderr ?? "" }));
      } else {
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      }
    });
  });
}

// ── GitService ──────────────────────────────────────────────────────────────

export class GitService {
  private exec: ExecFn;

  constructor(
    private repoRoot: string,
    exec?: ExecFn
  ) {
    this.exec = exec ?? defaultExec;
  }

  /** Get the repository root (git rev-parse --show-toplevel). */
  async getRepoRoot(): Promise<GitResult<string>> {
    return this.run(["rev-parse", "--show-toplevel"], (s) => s.trim());
  }

  /** Get the current branch name. */
  async getCurrentBranch(): Promise<GitResult<string>> {
    return this.run(["rev-parse", "--abbrev-ref", "HEAD"], (s) => s.trim());
  }

  /** Resolve a ref to a full commit hash. */
  async revParse(ref: string): Promise<GitResult<string>> {
    return this.run(["rev-parse", ref], (s) => s.trim());
  }

  /** Find the merge-base (common ancestor) of two refs. */
  async getMergeBase(refA: string, refB: string): Promise<GitResult<string>> {
    return this.run(["merge-base", refA, refB], (s) => s.trim());
  }

  /** List files changed between two refs. */
  async listChangedFiles(fromRef: string, toRef: string): Promise<GitResult<string[]>> {
    return this.run(
      ["diff", "--name-only", fromRef, toRef],
      (s) => s.trim().split("\n").filter((f) => f.length > 0)
    );
  }

  /** Check if the working tree (or a specific path) has uncommitted changes. */
  async isDirty(path?: string): Promise<GitResult<boolean>> {
    const args = ["status", "--porcelain"];
    if (path) { args.push("--", path); }
    return this.run(args, (s) => s.trim().length > 0);
  }

  /** Create a new branch from a ref. */
  async createBranch(branch: string, fromRef: string): Promise<GitResult<void>> {
    return this.runVoid(["branch", branch, fromRef]);
  }

  /** Add a git worktree at path on branch. */
  async worktreeAdd(path: string, branch: string): Promise<GitResult<void>> {
    return this.runVoid(["worktree", "add", path, branch]);
  }

  /** Remove a git worktree. */
  async worktreeRemove(worktreePath: string): Promise<GitResult<void>> {
    return this.runVoid(["worktree", "remove", worktreePath, "--force"]);
  }

  /** List all git worktrees (porcelain format). */
  async worktreeList(): Promise<GitResult<WorktreeEntry[]>> {
    return this.run(["worktree", "list", "--porcelain"], (stdout) => {
      return parseWorktreeListPorcelain(stdout);
    });
  }

  /** Cherry-pick a single commit. */
  async cherryPick(commit: string): Promise<GitResult<void>> {
    return this.runVoid(["cherry-pick", commit]);
  }

  /** Merge a branch with --no-ff. Returns the merge commit hash on success. */
  async mergeNoFf(branch: string): Promise<GitResult<string>> {
    const mergeResult = await this.runVoid(["merge", "--no-ff", branch]);
    if (!mergeResult.ok) {
      return failure(mergeResult.error ?? "merge failed", mergeResult.stderr);
    }
    // Get the new HEAD (the merge commit)
    return this.revParse("HEAD");
  }

  /** Abort an in-progress merge. */
  async abortMerge(): Promise<GitResult<void>> {
    return this.runVoid(["merge", "--abort"]);
  }

  /** Delete a branch (force). */
  async deleteBranch(branch: string): Promise<GitResult<void>> {
    return this.runVoid(["branch", "-D", branch]);
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  private async run<T>(args: string[], parse: (stdout: string) => T): Promise<GitResult<T>> {
    try {
      const { stdout } = await this.exec("git", args, { cwd: this.repoRoot });
      return success(parse(stdout));
    } catch (err: unknown) {
      const e = err as { message?: string; stderr?: string };
      return failure(e.message ?? "git command failed", e.stderr);
    }
  }

  private async runVoid(args: string[]): Promise<GitResult<void>> {
    try {
      await this.exec("git", args, { cwd: this.repoRoot });
      return success(undefined);
    } catch (err: unknown) {
      const e = err as { message?: string; stderr?: string };
      return failure(e.message ?? "git command failed", e.stderr);
    }
  }
}

// ── Porcelain parser ────────────────────────────────────────────────────────

/**
 * Parse `git worktree list --porcelain` output into WorktreeEntry[].
 *
 * Format is blocks separated by blank lines:
 *   worktree /path/to/worktree
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *   (blank line)
 */
export function parseWorktreeListPorcelain(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = stdout.split("\n\n").filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let entryPath = "";
    let head = "";
    let branch = "";

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        entryPath = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        // refs/heads/main → main
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }

    if (entryPath) {
      entries.push({ path: entryPath, branch, head });
    }
  }

  return entries;
}
