/**
 * governance/types.ts — Shared types for the governance system.
 * Simplified from cursor-drive's Zod schemas to plain TS interfaces.
 */

export interface FileNode {
  path: string;
  kind: "src" | "test" | "doc" | "plan" | "config" | "other";
  loc: number;
  imports: string[];
  exports: string[];
}

export interface ProjectGraphSnapshot {
  files: FileNode[];
  timestamp: number;
}

export type FindingCategory =
  | "dead_code"
  | "redundancy"
  | "test_gaps"
  | "todo_density"
  | "abstraction"
  | "dependency_depth"
  | "focus";

export interface Finding {
  category: FindingCategory;
  severity: "low" | "medium" | "high";
  file?: string;
  message: string;
  evidence?: string;
}

export interface EntropyMetrics {
  deadCodeRatio: number;
  redundancy: number;
  testGapIndex: number;
  todoDensity: number;
  abstractionIndex: number;
  depChainP95: number;
}

export interface EntropyReport {
  score: number;
  metrics: EntropyMetrics;
  findings: Finding[];
  timestamp: number;
}

export type TaskPriority = "p0" | "p1" | "p2";
export type TaskEffort = "xs" | "s" | "m" | "l";

export interface Task {
  id: string;
  title: string;
  priority: TaskPriority;
  effort: TaskEffort;
  category: FindingCategory;
  evidence: string[];
}

export interface TaskLedger {
  tasks: Task[];
  generatedAt: number;
}

export interface GovernanceScanResult {
  entropyScore: number;
  taskCount: number;
  warnings: string[];
  reportPath: string;
}
