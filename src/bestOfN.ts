/**
 * bestOfN.ts — Parallel best-of-N operator runs with a pluggable scorer.
 *
 * Spawns `count` operators, runs them concurrently in background execution mode,
 * and picks a winner from the collected stats. Does not auto-merge; the caller
 * decides what to do with the winning worktree/result.
 */
import { runOperator } from "./operatorManager.js";
import type { OperatorContext, OperatorRegistry } from "./operatorRegistry.js";
import type { OperatorRole, PermissionPreset, EffortLevel } from "./operatorRegistry.js";
import { getConfig } from "./config.js";
import { readProgressSnapshot } from "./progressFile.js";

export interface BestOfNResultEntry {
  op: OperatorContext;
  model?: string;
  success: boolean;
  error?: string;
  stats?: {
    totalCostUsd: number;
    durationMs: number;
    numTurns: number;
  };
  lastSummary?: string;
}

export interface BestOfNOptions {
  count?: number;
  models?: string[];
  preset?: PermissionPreset;
  role?: OperatorRole;
  effort?: EffortLevel;
  cwd?: string;
  mcpServerUrl?: string;
  namePrefix?: string;
  /** Override scorer. Default: lowest cost, prefer success. */
  scorer?: (results: BestOfNResultEntry[]) => number;
  /** Progress-file base directory override (for tests). */
  progressBaseDir?: string;
  /** Abort signal (cancels all remaining runs). */
  abortSignal?: AbortSignal;
}

export interface BestOfNResult {
  winnerIndex: number;
  winner?: BestOfNResultEntry;
  all: BestOfNResultEntry[];
}

function defaultScorer(results: BestOfNResultEntry[]): number {
  // Prefer successful runs; within successes, lowest totalCostUsd wins.
  const successes = results
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.success);
  const pool = successes.length > 0 ? successes : results.map((r, i) => ({ r, i }));
  pool.sort((a, b) => {
    const ca = a.r.stats?.totalCostUsd ?? Number.POSITIVE_INFINITY;
    const cb = b.r.stats?.totalCostUsd ?? Number.POSITIVE_INFINITY;
    return ca - cb;
  });
  return pool[0]?.i ?? 0;
}

export async function runBestOfN(
  task: string,
  registry: OperatorRegistry,
  opts: BestOfNOptions = {},
): Promise<BestOfNResult> {
  if (getConfig<boolean>("bestOfN.enabled") === false) {
    throw new Error("best-of-N is disabled (config: bestOfN.enabled = false)");
  }
  const maxCount = getConfig<number>("bestOfN.maxCount") ?? 4;
  const requested = opts.count ?? 2;
  const count = Math.max(1, Math.min(maxCount, requested));
  const prefix = opts.namePrefix ?? "bestof";

  // Spawn all operators up-front.
  const operators: OperatorContext[] = [];
  for (let i = 0; i < count; i++) {
    const op = registry.spawn(`${prefix}-${i + 1}`, task, {
      preset: opts.preset,
      role: opts.role,
      effort: opts.effort,
      executionMode: "background",
    });
    operators.push(op);
  }

  // Dispatch in parallel.
  const runs = operators.map((op, i) =>
    (async (): Promise<BestOfNResultEntry> => {
      const model = opts.models?.[i];
      const entry: BestOfNResultEntry = { op, model, success: false };
      try {
        await runOperator(op, task, {
          isBackground: true,
          registry,
          effort: opts.effort,
          cwd: opts.cwd,
          mcpServerUrl: opts.mcpServerUrl,
          progressBaseDir: opts.progressBaseDir,
          abortSignal: opts.abortSignal,
          onTaskComplete: (_o, stats) => {
            entry.stats = {
              totalCostUsd: stats.totalCostUsd,
              durationMs: stats.durationMs,
              numTurns: stats.numTurns,
            };
          },
        });
        entry.success = true;
      } catch (e) {
        entry.success = false;
        entry.error = e instanceof Error ? e.message : String(e);
      }
      try {
        const snap = readProgressSnapshot(op.id, opts.progressBaseDir);
        const lastProgress = [...snap.events].reverse().find((ev) => ev.type === "task_progress");
        entry.lastSummary = (lastProgress as { summary?: string; description?: string } | undefined)?.summary
          ?? (lastProgress as { description?: string } | undefined)?.description;
      } catch {
        /* ignore */
      }
      return entry;
    })(),
  );

  const all = await Promise.all(runs);

  const scorer = opts.scorer ?? defaultScorer;
  const winnerIndex = scorer(all);
  const winner = all[winnerIndex];

  return { winnerIndex, winner, all };
}
