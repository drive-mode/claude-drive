/**
 * stateSyncCoordinator.ts — Orchestrates operator → user branch sync.
 * Manages proposals, approval tracking, and activity logging.
 * Ported from cursor-drive for Node.js.
 */

import { GitService, GitResult } from "./gitService.js";
import { OperatorRegistry, OperatorContext } from "./operatorRegistry.js";
import { WorktreeManager, WorktreeAllocation } from "./worktreeManager.js";
import { SyncLedger } from "./syncLedger.js";
import { store } from "./store.js";
import type {
  SyncState,
  SyncStatusSnapshot,
  OperatorWorkspaceState,
  SyncProposal,
  SyncProposalStatus,
  OperatorActivityEvent,
} from "./syncTypes.js";

export class StateSyncCoordinator {
  private proposals: Map<string, SyncProposal> = new Map();
  private activityLog: OperatorActivityEvent[] = [];
  private ledger: SyncLedger;

  constructor(
    private gitService: GitService,
    private operatorRegistry: OperatorRegistry,
    private worktreeManager: WorktreeManager,
    private repoRoot: string
  ) {
    this.ledger = new SyncLedger(repoRoot);
  }

  /**
   * Compute a snapshot of the current sync state.
   * Queries git and the operator registry to build complete state.
   */
  async computeSnapshot(): Promise<SyncStatusSnapshot> {
    const userBranchResult = await this.gitService.getCurrentBranch();
    const userBranch = userBranchResult.ok ? userBranchResult.data ?? "unknown" : "unknown";

    const userHeadResult = await this.gitService.revParse("HEAD");
    const userHead = userHeadResult.ok ? userHeadResult.data ?? "unknown" : "unknown";

    const operators = await this.computeOperatorStates();

    return {
      userBranch,
      userHead,
      operators,
      proposals: [...this.proposals.values()],
      timestamp: Date.now(),
    };
  }

  /**
   * Build operator workspace state for each active operator.
   */
  private async computeOperatorStates(): Promise<OperatorWorkspaceState[]> {
    const states: OperatorWorkspaceState[] = [];
    const active = this.operatorRegistry.getActive();

    for (const op of active) {
      const allocation = this.worktreeManager.getAllocation(op.id);
      if (!allocation) {
        continue;
      }

      const headResult = await this.gitService.revParse(allocation.branchName);
      const baseResult = await this.gitService.revParse("HEAD");
      const mergeBaseResult = await this.gitService.getMergeBase(
        allocation.branchName,
        "HEAD"
      );
      const changedResult = await this.gitService.listChangedFiles(
        "HEAD",
        allocation.branchName
      );

      const state: OperatorWorkspaceState = {
        operatorId: op.id,
        operatorName: op.name,
        worktreePath: allocation.worktreePath,
        branchName: allocation.branchName,
        baseCommit: baseResult.ok ? baseResult.data ?? "" : "",
        headCommit: headResult.ok ? headResult.data ?? "" : "",
        mergeBase: mergeBaseResult.ok ? mergeBaseResult.data ?? "" : "",
        syncState: (op.syncState ?? "idle") as SyncState,
        changedFiles: changedResult.ok ? changedResult.data ?? [] : [],
      };

      states.push(state);
    }

    return states;
  }

  /**
   * Generate sync proposals from operator branches.
   * One proposal per operator with changes.
   */
  async generateProposals(): Promise<SyncProposal[]> {
    const snapshot = await this.computeSnapshot();
    const newProposals: SyncProposal[] = [];

    for (const opState of snapshot.operators) {
      if (opState.changedFiles.length === 0) {
        continue;
      }

      const id = `proposal-${opState.operatorId}-${Date.now()}`;

      // Detect conflicts by attempting a dry merge.
      const conflictingFiles = await this.detectConflicts(
        opState.branchName,
        snapshot.userBranch
      );

      const status: SyncProposalStatus = conflictingFiles.length > 0 ? "conflict" : "pending_review";

      const proposal: SyncProposal = {
        id,
        operatorId: opState.operatorId,
        operatorName: opState.operatorName,
        baseCommit: opState.baseCommit,
        headCommit: opState.headCommit,
        changedFiles: opState.changedFiles,
        conflictingFiles,
        status,
        createdAt: Date.now(),
      };

      this.proposals.set(id, proposal);
      newProposals.push(proposal);
    }

    if (newProposals.length > 0) this.persistProposals();
    return newProposals;
  }

  /**
   * Detect conflicting files by attempting a merge-base analysis.
   * Returns list of files that would conflict.
   */
  private async detectConflicts(branchName: string, targetBranch: string): Promise<string[]> {
    // Simple conflict detection: find files changed in both branches since merge-base.
    const mergeBaseResult = await this.gitService.getMergeBase(branchName, targetBranch);
    if (!mergeBaseResult.ok) {
      return [];
    }

    const mergeBase = mergeBaseResult.data ?? "";
    const changedInBranchResult = await this.gitService.listChangedFiles(mergeBase, branchName);
    const changedInTargetResult = await this.gitService.listChangedFiles(
      mergeBase,
      targetBranch
    );

    const changedInBranch = new Set(changedInBranchResult.data ?? []);
    const changedInTarget = new Set(changedInTargetResult.data ?? []);

    const conflicts: string[] = [];
    for (const file of changedInBranch) {
      if (changedInTarget.has(file)) {
        conflicts.push(file);
      }
    }

    return conflicts;
  }

  /**
   * Approve a proposal for merging.
   */
  approveProposal(id: string, actor = "system"): boolean {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      return false;
    }

    proposal.status = "approved";
    proposal.decidedAt = Date.now();
    this.persistProposals();

    this.ledger.append({
      proposalId: id,
      action: "approved",
      actor,
      timestamp: Date.now(),
    }).catch((e) => console.error("[stateSyncCoordinator] Failed to log approval:", e));

    return true;
  }

  /**
   * Reject a proposal.
   */
  rejectProposal(id: string, actor = "system"): boolean {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      return false;
    }

    proposal.status = "rejected";
    proposal.decidedAt = Date.now();
    this.persistProposals();

    this.ledger.append({
      proposalId: id,
      action: "rejected",
      actor,
      timestamp: Date.now(),
    }).catch((e) => console.error("[stateSyncCoordinator] Failed to log rejection:", e));

    return true;
  }

  /**
   * Get a specific proposal by ID.
   */
  getProposal(id: string): SyncProposal | undefined {
    return this.proposals.get(id);
  }

  /**
   * Get all proposals that haven't been resolved yet.
   */
  getActiveProposals(): SyncProposal[] {
    return [...this.proposals.values()].filter(
      (p) => p.status === "pending_review" || p.status === "approved" || p.status === "applying"
    );
  }

  /**
   * Mark a proposal as currently applying.
   */
  markApplying(id: string): boolean {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      return false;
    }
    proposal.status = "applying";
    this.persistProposals();
    return true;
  }

  /**
   * Mark a proposal as successfully applied.
   */
  markApplied(id: string, actor = "system"): boolean {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      return false;
    }
    proposal.status = "applied";
    proposal.appliedAt = Date.now();
    this.persistProposals();

    this.ledger.append({
      proposalId: id,
      action: "applied",
      actor,
      timestamp: Date.now(),
    }).catch((e) => console.error("[stateSyncCoordinator] Failed to log applied:", e));

    return true;
  }

  /**
   * Mark a proposal as failed to apply.
   */
  markFailed(id: string, error: string, actor = "system"): boolean {
    const proposal = this.proposals.get(id);
    if (!proposal) {
      return false;
    }
    proposal.status = "failed_apply";
    proposal.error = error;
    this.persistProposals();

    this.ledger.append({
      proposalId: id,
      action: "failed",
      actor,
      timestamp: Date.now(),
      metadata: { error },
    }).catch((e) => console.error("[stateSyncCoordinator] Failed to log failure:", e));

    return true;
  }

  /**
   * Push an activity event to the log.
   */
  pushActivityEvent(event: OperatorActivityEvent): void {
    this.activityLog.push(event);
    // Keep only recent events in memory (last 500).
    if (this.activityLog.length > 500) {
      this.activityLog = this.activityLog.slice(-500);
    }
  }

  /**
   * Get recent activity events.
   */
  getRecentEvents(limit = 20): OperatorActivityEvent[] {
    return [...this.activityLog].reverse().slice(0, limit);
  }

  /**
   * Clear all proposals and activity (for session reset).
   */
  reset(): void {
    this.proposals.clear();
    this.activityLog = [];
    this.persistProposals();
  }

  private persistProposals(): void {
    store.update("sync.proposals", [...this.proposals.values()]);
  }

  restore(): void {
    const saved = store.get<SyncProposal[] | undefined>("sync.proposals", undefined);
    if (!saved || !Array.isArray(saved)) return;
    for (const proposal of saved) {
      this.proposals.set(proposal.id, proposal);
    }
  }
}
