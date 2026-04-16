/**
 * registry/types.ts — Type declarations shared across the registry surface.
 *
 * Keeping the pure type declarations in a separate file lets the actual class
 * focus on behaviour, and avoids any import-cycle risk with sibling modules
 * that only need the types.
 */

export type SyncState = "idle" | "syncing" | "conflict" | "applying" | "error";

export type OperatorStatus = "active" | "background" | "completed" | "merged" | "paused";
export type OperatorRole = "implementer" | "reviewer" | "tester" | "researcher" | "planner";

/** Claude Agent SDK effort level: `low | medium | high | xhigh | max`. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** Whether an operator runs in the calling turn (foreground) or detached (background). */
export type ExecutionMode = "foreground" | "background";

export type OperatorVisibility = "isolated" | "shared" | "collaborative";

export type PermissionPreset = "readonly" | "standard" | "full";

/** Per-category + total context window usage reported by the SDK. */
export interface ContextUsage {
  total: number;
  maxTokens?: number;
  percentage?: number;
  byCategory: Record<string, number>;
  updatedAt: number;
}

export interface EscalationEvent {
  operatorId: string;
  operatorName: string;
  reason: string;
  severity: "info" | "warning" | "critical";
  timestamp: number;
}

export interface OperatorStats {
  totalCostUsd: number;
  totalDurationMs: number;
  totalApiDurationMs: number;
  totalTurns: number;
  taskCount: number;
}

export interface OperatorContext {
  id: string;
  name: string;
  voice: string | undefined;
  task: string;
  status: OperatorStatus;
  createdAt: number;
  memory: string[];
  visibility: OperatorVisibility;
  depth: number;
  parentId?: string;
  permissionPreset: PermissionPreset;
  role?: OperatorRole;
  systemHint?: string;
  worktreePath?: string;
  branchName?: string;
  baseCommit?: string;
  headCommit?: string;
  syncState?: SyncState;
  sessionId?: string;
  stats: OperatorStats;
  /** Controller to cancel in-flight tasks when operator is dismissed. */
  abortController?: AbortController;
  /** Whether the operator blocks its caller (foreground) or runs detached (background). */
  executionMode: ExecutionMode;
  /** In-flight task promise (set by operatorManager.runOperator). */
  runPromise?: Promise<void>;
  /** Absolute path to this operator's progress directory (set for background runs). */
  progressPath?: string;
  /** Most recent context-usage snapshot. */
  contextUsage?: ContextUsage;
  /** Effort/thinking level passthrough for SDK `query()`. */
  effort?: EffortLevel;
  /** Agent-definition name that spawned this operator, if any. */
  agentDefinitionName?: string;
}

export interface OperatorTreeNode {
  op: OperatorContext;
  children: OperatorTreeNode[];
}

export interface SpawnOptions {
  preset?: PermissionPreset;
  parentId?: string;
  depth?: number;
  role?: OperatorRole;
  executionMode?: ExecutionMode;
  effort?: EffortLevel;
  agentDefinitionName?: string;
}
