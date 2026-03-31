/**
 * integrationQueue.ts — FIFO queue with mutex for safe proposal application.
 * Serializes merge operations to prevent race conditions and conflicts.
 */

import { GitService } from "./gitService.js";
import { StateSyncCoordinator } from "./stateSyncCoordinator.js";
import { OperatorRegistry } from "./operatorRegistry.js";
import { store } from "./store.js";
import type { SyncProposal } from "./syncTypes.js";

export interface ApplyResult {
  proposalId: string;
  success: boolean;
  mergeCommit?: string;
  error?: string;
  conflictFiles?: string[];
}

export class IntegrationQueue {
  private queue: SyncProposal[] = [];
  /** Promise-chain mutex — ensures one operation at a time. */
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private gitService: GitService,
    private coordinator: StateSyncCoordinator,
    private operatorRegistry?: OperatorRegistry
  ) {}

  /**
   * Enqueue a proposal for application.
   */
  enqueue(proposal: SyncProposal): void {
    this.queue.push(proposal);
    this.persist();
  }

  /**
   * Process the next proposal in the queue.
   * Returns the result of the merge operation or undefined if queue is empty.
   */
  async processNext(): Promise<ApplyResult | undefined> {
    const proposal = this.queue.shift();
    if (!proposal) {
      return undefined;
    }
    this.persist();

    return this.serialized(async () => {
      return this.applyProposal(proposal);
    });
  }

  /**
   * Process all proposals in the queue sequentially.
   */
  async processAll(): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];
    while (this.queue.length > 0) {
      const result = await this.processNext();
      if (result) {
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Get the current queue length.
   */
  length(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue without processing.
   */
  clear(): void {
    this.queue = [];
    this.persist();
  }

  private persist(): void {
    store.update("integrationQueue.items", this.queue.map((p) => ({ ...p })));
  }

  restore(): void {
    const saved = store.get<SyncProposal[] | undefined>("integrationQueue.items", undefined);
    if (!saved || !Array.isArray(saved)) return;
    this.queue = saved;
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /**
   * Apply a single proposal by merging its branch into the user branch.
   */
  private async applyProposal(proposal: SyncProposal): Promise<ApplyResult> {
    const result: ApplyResult = {
      proposalId: proposal.id,
      success: false,
    };

    try {
      // Mark as applying.
      this.coordinator.markApplying(proposal.id);

      // Get the operator to find its branch name.
      const operator = this.operatorRegistry?.findByNameOrId(proposal.operatorId);
      if (!operator || !operator.branchName) {
        const error = "Operator branch not found";
        result.error = error;
        this.coordinator.markFailed(proposal.id, error);
        return result;
      }

      // Attempt merge.
      const mergeResult = await this.gitService.mergeNoFf(operator.branchName);
      if (!mergeResult.ok) {
        const mergeError = mergeResult.error ?? "Unknown merge error";
        result.error = mergeError;

        // Check for conflicts.
        const statusResult = await this.gitService.isDirty();
        if (statusResult.ok && statusResult.data) {
          // Working tree is dirty — likely due to conflicts.
          // Try to detect which files have conflicts by checking status.
          result.conflictFiles = proposal.conflictingFiles;
          await this.gitService.abortMerge();
        }

        this.coordinator.markFailed(proposal.id, mergeError);
        return result;
      }

      // Success.
      const commit = mergeResult.data ?? "";
      result.success = true;
      result.mergeCommit = commit;

      this.coordinator.markApplied(proposal.id);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.error = errorMsg;
      this.coordinator.markFailed(proposal.id, errorMsg);
      return result;
    }
  }

  /**
   * Serialize an async operation through the promise-chain lock.
   */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}
