/**
 * syncTypes.ts — Shared types for the state sync system.
 * Defines operator workspace state, sync proposals, and activity events.
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
  userHead: string;
  operators: OperatorWorkspaceState[];
  proposals: SyncProposal[];
  timestamp: number;
}

export interface OperatorActivityEvent {
  type: "activity" | "file" | "decision" | "sync" | "merge";
  operatorId?: string;
  operatorName?: string;
  text: string;
  timestamp: number;
}
