/**
 * governance/schemas.ts — Zod schemas for runtime validation of governance types.
 */
import { z } from "zod";

// ── FileNode ───────────────────────────────────────────────────────────────

export const fileNodeSchema = z.object({
  path: z.string(),
  kind: z.enum(["src", "test", "doc", "plan", "config", "other"]),
  loc: z.number().int().min(0),
  imports: z.array(z.string()),
  exports: z.array(z.string()),
});

// ── ProjectGraphSnapshot ───────────────────────────────────────────────────

export const projectGraphSnapshotSchema = z.object({
  files: z.array(fileNodeSchema),
  timestamp: z.number(),
});

// ── Finding ────────────────────────────────────────────────────────────────

export const findingCategorySchema = z.enum([
  "dead_code",
  "redundancy",
  "test_gaps",
  "todo_density",
  "abstraction",
  "dependency_depth",
  "focus",
]);

export const findingSchema = z.object({
  category: findingCategorySchema,
  severity: z.enum(["low", "medium", "high"]),
  file: z.string().optional(),
  message: z.string(),
  evidence: z.string().optional(),
});

// ── EntropyReport ──────────────────────────────────────────────────────────

export const entropyMetricsSchema = z.object({
  deadCodeRatio: z.number(),
  redundancy: z.number(),
  testGapIndex: z.number(),
  todoDensity: z.number(),
  abstractionIndex: z.number(),
  depChainP95: z.number(),
});

export const entropyReportSchema = z.object({
  score: z.number(),
  metrics: entropyMetricsSchema,
  findings: z.array(findingSchema),
  timestamp: z.number(),
});

// ── Task / TaskLedger ──────────────────────────────────────────────────────

export const taskPrioritySchema = z.enum(["p0", "p1", "p2"]);
export const taskEffortSchema = z.enum(["xs", "s", "m", "l"]);

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: taskPrioritySchema,
  effort: taskEffortSchema,
  category: findingCategorySchema,
  evidence: z.array(z.string()),
});

export const taskLedgerSchema = z.object({
  tasks: z.array(taskSchema),
  generatedAt: z.number(),
});

// ── GovernanceScanResult ───────────────────────────────────────────────────

export const governanceScanResultSchema = z.object({
  entropyScore: z.number(),
  taskCount: z.number().int().min(0),
  warnings: z.array(z.string()),
  reportPath: z.string(),
});

// ── Validation helper ──────────────────────────────────────────────────────

/**
 * Validate a scan result at runtime. Throws ZodError on invalid data.
 */
export function validateScanResult(data: unknown) {
  return governanceScanResultSchema.parse(data);
}
