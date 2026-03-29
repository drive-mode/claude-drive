/**
 * promptOptimizer.ts — Autonomous prompt optimization loop for claude-drive.
 *
 * Implements Karpathy's AutoResearch hill-climbing pattern:
 * Mutate → Evaluate → Keep/Revert → Loop
 *
 * Optimizes a mutable prompt (skill template, system prompt, or reflection rules)
 * against an evaluation suite using 6 mutation operators.
 */
import { getConfig } from "./config.js";
import { atomicWriteJSON } from "./atomicWrite.js";
import {
  loadScenarios,
  scoreOutput,
  buildEvalResult,
  buildSuiteResult,
  compareResults,
  saveResult,
} from "./evaluationHarness.js";
import type { EvalScenario, EvalSuiteResult } from "./evaluationHarness.js";
import type { ReflectionRule } from "./reflectionGate.js";
import fs from "fs";
import path from "path";
import os from "os";

// ── Types ───────────────────────────────────────────────────────────────────

export type MutationOperator =
  | "add-constraint"
  | "add-negative-example"
  | "restructure"
  | "tighten-language"
  | "remove-bloat"
  | "add-counterexample";

export const ALL_MUTATION_OPERATORS: MutationOperator[] = [
  "add-constraint",
  "add-negative-example",
  "restructure",
  "tighten-language",
  "remove-bloat",
  "add-counterexample",
];

export interface OptimizationConfig {
  maxIterations: number;
  mutationOperators: MutationOperator[];
  baselinePrompt: string;
  evalScenarios: EvalScenario[];       // scenarios to evaluate against
  improvementThreshold: number;         // min score delta to keep (default 0.02)
  checkpointEvery: number;              // checkpoint every N iterations (default 5)
  optimizeReflectionRules: boolean;     // also optimize reflection rule set
  dryRun?: boolean;                     // skip actual API calls (for testing)
}

export interface OptimizationStep {
  iteration: number;
  mutationOperator: MutationOperator;
  mutatedPrompt: string;
  score: number;
  baselineScore: number;
  kept: boolean;
  reason: string;
  durationMs: number;
}

export interface OptimizationRun {
  id: string;
  status: "running" | "completed" | "stopped";
  config: OptimizationConfig;
  currentIteration: number;
  bestPrompt: string;
  bestScore: number;
  bestReflectionRules?: ReflectionRule[];
  baselineScore: number;
  history: OptimizationStep[];
  startedAt: number;
  completedAt?: number;
}

// ── Mutation Prompts ────────────────────────────────────────────────────────

/** Focused prompts for each mutation operator — sent via Claude API. */
export const MUTATION_PROMPTS: Record<MutationOperator, string> = {
  "add-constraint": [
    "You are a prompt optimizer. Add ONE specific constraint or rule to this prompt",
    "that would prevent common failure modes. The constraint should be concrete,",
    "actionable, and testable. Do not change the existing text — only add the new constraint.",
    "Return ONLY the modified prompt text, nothing else.",
  ].join(" "),

  "add-negative-example": [
    "You are a prompt optimizer. Add ONE example of what NOT to do to this prompt.",
    "The negative example should illustrate a common mistake or anti-pattern.",
    "Do not change the existing text — only add the negative example.",
    "Return ONLY the modified prompt text, nothing else.",
  ].join(" "),

  "restructure": [
    "You are a prompt optimizer. Reorganize this prompt for maximum clarity",
    "without changing its meaning or removing any content.",
    "Use better headings, ordering, or grouping to improve readability.",
    "Return ONLY the modified prompt text, nothing else.",
  ].join(" "),

  "tighten-language": [
    "You are a prompt optimizer. Replace vague or ambiguous words with precise,",
    "specific language. Examples: 'try to' → 'must', 'some' → exact quantity,",
    "'good' → specific quality criteria. Do not change the structure.",
    "Return ONLY the modified prompt text, nothing else.",
  ].join(" "),

  "remove-bloat": [
    "You are a prompt optimizer. Remove unnecessary words, redundant phrases,",
    "and filler text while preserving ALL meaning and instructions.",
    "Every word should earn its place. Do not remove constraints or examples.",
    "Return ONLY the modified prompt text, nothing else.",
  ].join(" "),

  "add-counterexample": [
    "You are a prompt optimizer. Add ONE edge case or counterexample that this",
    "prompt should handle correctly. The counterexample should test boundary",
    "conditions or unusual inputs. Do not change existing text.",
    "Return ONLY the modified prompt text, nothing else.",
  ].join(" "),
};

// ── Active Runs ─────────────────────────────────────────────────────────────

const activeRuns = new Map<string, OptimizationRun>();
const abortControllers = new Map<string, AbortController>();

// ── Mutation Engine ─────────────────────────────────────────────────────────

/**
 * Apply a mutation operator to a prompt using the Claude API.
 * Uses a cheap model (haiku) for fast, focused mutations.
 */
export async function applyMutation(
  prompt: string,
  operator: MutationOperator,
  opts?: { dryRun?: boolean },
): Promise<string> {
  if (opts?.dryRun) {
    // In dry-run / test mode, simulate a mutation
    return `${prompt}\n[MUTATED by ${operator}]`;
  }

  const model = getConfig<string>("optimizer.mutationModel") ?? "claude-haiku-4-5-20251001";

  // Lazy-import the Anthropic SDK
  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try {
    const sdk = await import("@anthropic-ai/sdk");
    Anthropic = sdk.default;
  } catch {
    throw new Error("@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk");
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `${MUTATION_PROMPTS[operator]}\n\nCurrent prompt:\n---\n${prompt}\n---`,
    }],
  });

  // Extract text from response
  const textBlock = response.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in mutation response");
  }
  return textBlock.text.trim();
}

// ── Evaluation Helper ───────────────────────────────────────────────────────

/**
 * Quick-evaluate a prompt against scenarios using string matching.
 * This is a lightweight evaluation that doesn't run actual operators —
 * it scores the prompt itself against scenario expectations.
 *
 * For full operator-based evaluation, use the evaluationHarness directly.
 */
export function quickEvaluate(
  prompt: string,
  scenarios: EvalScenario[],
): { score: number; passRate: number; results: Array<{ scenarioId: string; score: number; passed: boolean }> } {
  const passThreshold = getConfig<number>("evaluation.passThreshold") ?? 0.7;
  const results = scenarios.map((scenario) => {
    const { score } = scoreOutput(scenario, prompt);
    return { scenarioId: scenario.id, score, passed: score >= passThreshold };
  });

  const passRate = results.length > 0
    ? results.filter((r) => r.passed).length / results.length
    : 0;
  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.score, 0) / results.length
    : 0;

  return { score: avgScore, passRate, results };
}

// ── Main Optimization Loop ──────────────────────────────────────────────────

/**
 * Start an autonomous optimization loop (hill-climbing).
 * Runs in the background and updates the OptimizationRun in-place.
 */
export async function startOptimization(config: OptimizationConfig): Promise<OptimizationRun> {
  const runId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();

  const run: OptimizationRun = {
    id: runId,
    status: "running",
    config,
    currentIteration: 0,
    bestPrompt: config.baselinePrompt,
    bestScore: 0,
    baselineScore: 0,
    history: [],
    startedAt: Date.now(),
  };

  activeRuns.set(runId, run);
  abortControllers.set(runId, controller);

  // Run the optimization loop asynchronously
  runOptimizationLoop(run, controller.signal).catch((err) => {
    run.status = "stopped";
    run.completedAt = Date.now();
    console.error(`[PromptOptimizer] Optimization ${runId} failed:`, err);
  });

  return run;
}

async function runOptimizationLoop(run: OptimizationRun, signal: AbortSignal): Promise<void> {
  const { config } = run;

  // Step 1: Evaluate baseline
  const baselineEval = quickEvaluate(config.baselinePrompt, config.evalScenarios);
  run.baselineScore = baselineEval.score;
  run.bestScore = baselineEval.score;

  // Step 2: Hill-climbing loop
  for (let i = 0; i < config.maxIterations; i++) {
    if (signal.aborted) {
      run.status = "stopped";
      run.completedAt = Date.now();
      return;
    }

    run.currentIteration = i + 1;
    const operatorIdx = i % config.mutationOperators.length;
    const mutationOp = config.mutationOperators[operatorIdx];

    const stepStart = Date.now();

    try {
      // Apply mutation
      const mutatedPrompt = await applyMutation(run.bestPrompt, mutationOp, {
        dryRun: config.dryRun,
      });

      // Evaluate mutated prompt
      const evalResult = quickEvaluate(mutatedPrompt, config.evalScenarios);
      const scoreDelta = evalResult.score - run.bestScore;
      const kept = scoreDelta >= config.improvementThreshold;

      const step: OptimizationStep = {
        iteration: i + 1,
        mutationOperator: mutationOp,
        mutatedPrompt,
        score: evalResult.score,
        baselineScore: run.bestScore,
        kept,
        reason: kept
          ? `Improved by ${(scoreDelta * 100).toFixed(1)}% (${(run.bestScore * 100).toFixed(1)}% → ${(evalResult.score * 100).toFixed(1)}%)`
          : `No improvement (delta: ${(scoreDelta * 100).toFixed(1)}%, threshold: ${(config.improvementThreshold * 100).toFixed(1)}%)`,
        durationMs: Date.now() - stepStart,
      };

      run.history.push(step);

      if (kept) {
        run.bestPrompt = mutatedPrompt;
        run.bestScore = evalResult.score;
      }

      // Checkpoint periodically
      if (config.checkpointEvery > 0 && (i + 1) % config.checkpointEvery === 0) {
        saveOptimizationRun(run);
      }
    } catch (err) {
      // Log error but continue loop
      const step: OptimizationStep = {
        iteration: i + 1,
        mutationOperator: mutationOp,
        mutatedPrompt: run.bestPrompt,
        score: run.bestScore,
        baselineScore: run.bestScore,
        kept: false,
        reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - stepStart,
      };
      run.history.push(step);
    }
  }

  run.status = "completed";
  run.completedAt = Date.now();
  saveOptimizationRun(run);
}

// ── Run Management ──────────────────────────────────────────────────────────

/** Stop a running optimization. */
export function stopOptimization(runId: string): boolean {
  const controller = abortControllers.get(runId);
  if (!controller) return false;
  controller.abort();
  abortControllers.delete(runId);

  const run = activeRuns.get(runId);
  if (run) {
    run.status = "stopped";
    run.completedAt = Date.now();
  }
  return true;
}

/** Get the current status of an optimization run. */
export function getOptimizationStatus(runId: string): OptimizationRun | undefined {
  return activeRuns.get(runId);
}

/** List all active/completed optimization runs. */
export function listOptimizationRuns(): OptimizationRun[] {
  return Array.from(activeRuns.values());
}

// ── Persistence ─────────────────────────────────────────────────────────────

function getOptimizationDir(): string {
  return path.join(os.homedir(), ".claude-drive", "optimization-runs");
}

function saveOptimizationRun(run: OptimizationRun): void {
  const dir = getOptimizationDir();
  atomicWriteJSON(path.join(dir, `${run.id}.json`), run);
}

/** Load a saved optimization run. */
export function loadOptimizationRun(runId: string): OptimizationRun | undefined {
  const filePath = path.join(getOptimizationDir(), `${runId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as OptimizationRun;
    }
  } catch {
    // Corrupted file
  }
  return undefined;
}

/** Get a summary of an optimization run. */
export function getOptimizationSummary(run: OptimizationRun): string {
  const keptSteps = run.history.filter((s) => s.kept);
  const totalImprovement = run.bestScore - run.baselineScore;

  return [
    `Optimization ${run.id} — ${run.status}`,
    `Iterations: ${run.currentIteration}/${run.config.maxIterations}`,
    `Baseline score: ${(run.baselineScore * 100).toFixed(1)}%`,
    `Best score: ${(run.bestScore * 100).toFixed(1)}%`,
    `Total improvement: ${totalImprovement >= 0 ? "+" : ""}${(totalImprovement * 100).toFixed(1)}%`,
    `Changes kept: ${keptSteps.length}/${run.history.length}`,
    keptSteps.length > 0
      ? `Effective mutations: ${keptSteps.map((s) => s.mutationOperator).join(", ")}`
      : "No effective mutations found",
    run.completedAt
      ? `Duration: ${((run.completedAt - run.startedAt) / 1000).toFixed(1)}s`
      : `Running for: ${((Date.now() - run.startedAt) / 1000).toFixed(1)}s`,
  ].join("\n");
}
