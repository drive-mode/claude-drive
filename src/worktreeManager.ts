/**
 * Worktree manager — per-operator git worktree lifecycle.
 *
 * Each operator gets an isolated worktree with a deterministic branch name
 * and path. The manager guards against concurrent mutations with a simple
 * promise-chain lock and supports idempotent allocate/release.
 *
 * Branch naming:  drive/op/<operatorId>
 * Path:           <repoRoot>/.drive/worktrees/<operatorId>/
 */

import * as path from "path";
import fs from "fs";
import { GitService } from "./gitService.js";
import { store } from "./store.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorktreeAllocation {
  operatorId: string;
  worktreePath: string;
  branchName: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const WORKTREE_DIR = ".drive/worktrees";
const BRANCH_PREFIX = "drive/op/";

// ── WorktreeManager ─────────────────────────────────────────────────────────

export class WorktreeManager {
  private allocations = new Map<string, WorktreeAllocation>();
  /** Promise-chain mutex — each mutation awaits the previous one. */
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private gitService: GitService,
    private repoRoot: string
  ) {}

  /**
   * Allocate a worktree for an operator. Idempotent — returns existing
   * allocation if already allocated.
   *
   * @param operatorId  Unique operator identifier.
   * @param baseRef     Git ref to base the branch on (default: HEAD).
   */
  async allocate(operatorId: string, baseRef = "HEAD"): Promise<WorktreeAllocation> {
    // Fast path: already allocated (no lock needed for read).
    const existing = this.allocations.get(operatorId);
    if (existing) { return existing; }

    return this.serialized(async () => {
      // Re-check inside lock (another caller may have allocated while we waited).
      const inner = this.allocations.get(operatorId);
      if (inner) { return inner; }

      const branchName = `${BRANCH_PREFIX}${operatorId}`;
      const worktreePath = path.join(this.repoRoot, WORKTREE_DIR, operatorId);

      // Create branch from base ref.
      const branchResult = await this.gitService.createBranch(branchName, baseRef);
      if (!branchResult.ok) {
        throw new Error(`Failed to create branch ${branchName}: ${branchResult.error}`);
      }

      // Add worktree.
      const wtResult = await this.gitService.worktreeAdd(worktreePath, branchName);
      if (!wtResult.ok) {
        // Rollback: delete the branch we just created.
        await this.gitService.deleteBranch(branchName);
        throw new Error(`Failed to add worktree at ${worktreePath}: ${wtResult.error}`);
      }

      const allocation: WorktreeAllocation = { operatorId, worktreePath, branchName };
      this.allocations.set(operatorId, allocation);
      this.persist();
      return allocation;
    });
  }

  /**
   * Release an operator's worktree and clean up the branch.
   * No-op if the operator has no allocation.
   */
  async release(operatorId: string): Promise<void> {
    return this.serialized(async () => {
      const allocation = this.allocations.get(operatorId);
      if (!allocation) { return; }

      // Remove worktree (force to handle dirty state).
      await this.gitService.worktreeRemove(allocation.worktreePath);
      // Delete the branch.
      await this.gitService.deleteBranch(allocation.branchName);

      this.allocations.delete(operatorId);
      this.persist();
    });
  }

  private persist(): void {
    store.update("worktrees.allocations", [...this.allocations.values()]);
  }

  restore(): void {
    const saved = store.get<WorktreeAllocation[] | undefined>("worktrees.allocations", undefined);
    if (!saved || !Array.isArray(saved)) return;
    for (const alloc of saved) {
      // Only restore allocations whose worktree path still exists on disk.
      try {
        if (fs.existsSync(alloc.worktreePath)) {
          this.allocations.set(alloc.operatorId, alloc);
        }
      } catch {
        // Skip allocations we can't verify.
      }
    }
  }

  /** Get the allocation for an operator (if any). */
  getAllocation(operatorId: string): WorktreeAllocation | undefined {
    return this.allocations.get(operatorId);
  }

  /** List all current allocations. */
  listAllocations(): WorktreeAllocation[] {
    return [...this.allocations.values()];
  }

  /**
   * Cleanup orphaned worktrees — those not matching any active operator.
   * @param activeOperatorIds  IDs of currently active operators.
   */
  async cleanup(activeOperatorIds: string[]): Promise<void> {
    return this.serialized(async () => {
      const activeSet = new Set(activeOperatorIds);
      const orphaned = [...this.allocations.entries()].filter(
        ([opId]) => !activeSet.has(opId)
      );

      for (const [opId, allocation] of orphaned) {
        await this.gitService.worktreeRemove(allocation.worktreePath);
        await this.gitService.deleteBranch(allocation.branchName);
        this.allocations.delete(opId);
      }
      if (orphaned.length > 0) this.persist();
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────

  /**
   * Serialize an async operation through the promise-chain lock.
   * Guarantees at most one mutation runs at a time.
   */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    // Update the lock to the tail of the chain (swallow result type).
    this.lock = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}
