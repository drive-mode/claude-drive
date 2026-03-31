/**
 * governance/index.ts — Re-exports for the governance module.
 */
export type {
  FileNode,
  ProjectGraphSnapshot,
  Finding,
  FindingCategory,
  EntropyMetrics,
  EntropyReport,
  Task,
  TaskLedger,
  TaskPriority,
  TaskEffort,
  GovernanceScanResult,
} from "./types.js";

export { buildProjectGraphSnapshot } from "./projectGraph.js";
export { computeEntropyReport, renderEntropyMarkdown } from "./entropy.js";
export { evaluateFocusGuard } from "./focusGuard.js";
export type { FocusGuardInput, FocusGuardResult } from "./focusGuard.js";
export { generateTaskLedger, renderWorkboardMarkdown, writeTaskLedger } from "./taskLedger.js";
export { runGovernanceScan } from "./scan.js";
export { getGovernancePaths, ensureGovernanceDirs } from "./paths.js";
export type { GovernancePaths } from "./paths.js";
export {
  fileNodeSchema,
  projectGraphSnapshotSchema,
  findingCategorySchema,
  findingSchema,
  entropyMetricsSchema,
  entropyReportSchema,
  taskPrioritySchema,
  taskEffortSchema,
  taskSchema,
  taskLedgerSchema,
  governanceScanResultSchema,
  validateScanResult,
} from "./schemas.js";
