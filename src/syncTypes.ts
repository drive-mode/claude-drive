/**
 * Shared contracts for the mob-programming sync control plane.
 * Copied verbatim from cursor-drive — no VS Code dependencies.
 */

export type SyncState = "idle" | "syncing" | "conflict" | "applying" | "error";

export interface OperatorWorkspaceState {
  operatorId: string;
  operatorName: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  headCommit: string;
  mergeBase: string;
  syncState: SyncState;
  changedFiles: string[];
}

export type SyncProposalStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "conflict"
  | "applying"
  | "applied"
  | "failed_apply";

export interface SyncProposal {
  id: string;
  operatorId: string;
  operatorName: string;
  baseCommit: string;
  headCommit: string;
  changedFiles: string[];
  conflictingFiles: string[];
  status: SyncProposalStatus;
  createdAt: number;
  decidedAt?: number;
  appliedAt?: number;
  error?: string;
}

export interface SyncStatusSnapshot {
  userBranch: string;
  userHeadCommit: string;
  operators: OperatorWorkspaceState[];
  proposals: SyncProposal[];
  timestamp: number;
}

export interface ApplyResult {
  success: boolean;
  proposalId: string;
  mergeCommit?: string;
  error?: string;
  conflictFiles?: string[];
}

export type OperatorActivityEventType =
  | "file_change"
  | "command"
  | "test"
  | "decision"
  | "sync"
  | "conflict"
  | "apply";

export interface OperatorActivityEvent {
  type: OperatorActivityEventType;
  operatorId: string;
  operatorName: string;
  detail: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LedgerDecisionRecord {
  proposalId: string;
  action: string;
  timestamp: number;
  actor?: string;
}
