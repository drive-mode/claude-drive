/**
 * evaluationHarness.ts — Test scenario runner and scoring for claude-drive.
 *
 * The "Measure" step of the AutoResearch optimization loop.
 * Runs operators against defined scenarios, scores results against
 * expected/forbidden behaviors, and tracks which reflection gates fired.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { getConfig } from "./config.js";
import { atomicWriteJSON } from "./atomicWrite.js";
import type { OperatorRole, PermissionPreset } from "./operatorRegistry.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EvalScenario {
  id: string;
  name: string;
  description: string;
  prompt: string;                 // task to give the operator
  expectedBehaviors: string[];    // regexes/substrings that should appear in output
  forbiddenBehaviors: string[];   // regexes/substrings that should NOT appear
  role?: OperatorRole;
  preset?: PermissionPreset;
  tags?: string[];
  timeoutMs?: number;             // max time per scenario (default from config)
}

export interface EvalResult {
  scenarioId: string;
  passed: boolean;
  score: number;                  // 0.0 - 1.0
  details: string;                // human-readable explanation
  expectedHits: string[];         // which expectedBehaviors matched
  expectedMisses: string[];       // which expectedBehaviors didn't match
  forbiddenHits: string[];        // which forbiddenBehaviors were found (bad)
  durationMs: number;
  costUsd: number;
  reflectionFired: string[];      // which reflection gate IDs triggered
}

export interface EvalSuiteResult {
  suiteId: string;
  timestamp: number;
  passRate: number;               // 0.0 - 1.0
  averageScore: number;           // mean score across all scenarios
  totalCostUsd: number;
  totalDurationMs: number;
  results: EvalResult[];
  promptSnapshot: string;         // the prompt version that was evaluated
  scenarioCount: number;
}

export interface EvalComparison {
  improved: boolean;
  passRateDelta: number;          // positive = better
  scoreDelta: number;
  details: string;
}

// ── Scenario Loading ────────────────────────────────────────────────────────

function getScenariosDir(): string {
  const configured = getConfig<string>("evaluation.scenariosDir");
  if (configured) return configured.replace(/^~/, os.homedir());
  return path.join(os.homedir(), ".claude-drive", "eval-scenarios");
}

function getResultsDir(): string {
  const configured = getConfig<string>("evaluation.resultsDir");
  if (configured) return configured.replace(/^~/, os.homedir());
  return path.join(os.homedir(), ".claude-drive", "eval-results");
}

/** Load all evaluation scenarios from the scenarios directory. */
export function loadScenarios(dir?: string): EvalScenario[] {
  const scenariosDir = dir ?? getScenariosDir();
  if (!fs.existsSync(scenariosDir)) return [];

  const scenarios: EvalScenario[] = [];
  const files = fs.readdirSync(scenariosDir).filter((f: string) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(scenariosDir, file), "utf-8");
      const parsed = JSON.parse(content);
      // Support both single scenario and array of scenarios
      if (Array.isArray(parsed)) {
        scenarios.push(...(parsed as EvalScenario[]));
      } else {
        scenarios.push(parsed as EvalScenario);
      }
    } catch {
      // Skip malformed files
    }
  }

  return scenarios;
}

/** Load scenarios filtered by tag. */
export function loadScenariosByTag(tag: string, dir?: string): EvalScenario[] {
  return loadScenarios(dir).filter((s) => s.tags?.includes(tag));
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/** Check if a behavior pattern matches the output text (substring or regex). */
function behaviorMatches(pattern: string, output: string): boolean {
  try {
    return new RegExp(pattern, "i").test(output);
  } catch {
    // Fall back to case-insensitive substring match
    return output.toLowerCase().includes(pattern.toLowerCase());
  }
}

/**
 * Score operator output against a scenario's expected/forbidden behaviors.
 * Returns a score from 0.0 to 1.0.
 */
export function scoreOutput(
  scenario: EvalScenario,
  output: string,
): { score: number; expectedHits: string[]; expectedMisses: string[]; forbiddenHits: string[] } {
  const expectedHits: string[] = [];
  const expectedMisses: string[] = [];
  const forbiddenHits: string[] = [];

  // Check expected behaviors
  for (const expected of scenario.expectedBehaviors) {
    if (behaviorMatches(expected, output)) {
      expectedHits.push(expected);
    } else {
      expectedMisses.push(expected);
    }
  }

  // Check forbidden behaviors
  for (const forbidden of scenario.forbiddenBehaviors) {
    if (behaviorMatches(forbidden, output)) {
      forbiddenHits.push(forbidden);
    }
  }

  // Calculate score
  const totalChecks = scenario.expectedBehaviors.length + scenario.forbiddenBehaviors.length;
  if (totalChecks === 0) return { score: 1.0, expectedHits, expectedMisses, forbiddenHits };

  const expectedScore = scenario.expectedBehaviors.length > 0
    ? expectedHits.length / scenario.expectedBehaviors.length
    : 1.0;

  const forbiddenScore = scenario.forbiddenBehaviors.length > 0
    ? 1.0 - (forbiddenHits.length / scenario.forbiddenBehaviors.length)
    : 1.0;

  // Weighted average: expected behaviors and forbidden behaviors equally important
  const score = (expectedScore + forbiddenScore) / 2;

  return { score, expectedHits, expectedMisses, forbiddenHits };
}

/**
 * Build a human-readable EvalResult from scoring output.
 */
export function buildEvalResult(
  scenario: EvalScenario,
  output: string,
  opts: { durationMs: number; costUsd: number; reflectionFired: string[] },
): EvalResult {
  const passThreshold = getConfig<number>("evaluation.passThreshold") ?? 0.7;
  const { score, expectedHits, expectedMisses, forbiddenHits } = scoreOutput(scenario, output);
  const passed = score >= passThreshold;

  const details = [
    `Score: ${(score * 100).toFixed(1)}% (threshold: ${(passThreshold * 100).toFixed(1)}%)`,
    expectedHits.length > 0 ? `Expected (found): ${expectedHits.join(", ")}` : null,
    expectedMisses.length > 0 ? `Expected (missing): ${expectedMisses.join(", ")}` : null,
    forbiddenHits.length > 0 ? `Forbidden (found!): ${forbiddenHits.join(", ")}` : null,
    opts.reflectionFired.length > 0 ? `Reflection gates fired: ${opts.reflectionFired.join(", ")}` : null,
  ].filter(Boolean).join("\n");

  return {
    scenarioId: scenario.id,
    passed,
    score,
    details,
    expectedHits,
    expectedMisses,
    forbiddenHits,
    durationMs: opts.durationMs,
    costUsd: opts.costUsd,
    reflectionFired: opts.reflectionFired,
  };
}

/**
 * Aggregate individual results into a suite result.
 */
export function buildSuiteResult(
  suiteId: string,
  results: EvalResult[],
  promptSnapshot: string,
): EvalSuiteResult {
  const passCount = results.filter((r) => r.passed).length;
  const passRate = results.length > 0 ? passCount / results.length : 0;
  const averageScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.score, 0) / results.length
    : 0;
  const totalCostUsd = results.reduce((sum, r) => sum + r.costUsd, 0);
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  return {
    suiteId,
    timestamp: Date.now(),
    passRate,
    averageScore,
    totalCostUsd,
    totalDurationMs,
    results,
    promptSnapshot,
    scenarioCount: results.length,
  };
}

// ── Comparison ──────────────────────────────────────────────────────────────

/** Compare two eval suite results to determine if there was improvement. */
export function compareResults(
  baseline: EvalSuiteResult,
  current: EvalSuiteResult,
): EvalComparison {
  const passRateDelta = current.passRate - baseline.passRate;
  const scoreDelta = current.averageScore - baseline.averageScore;
  const improved = scoreDelta > 0;

  const details = [
    `Pass rate: ${(baseline.passRate * 100).toFixed(1)}% → ${(current.passRate * 100).toFixed(1)}% (${passRateDelta >= 0 ? "+" : ""}${(passRateDelta * 100).toFixed(1)}%)`,
    `Average score: ${(baseline.averageScore * 100).toFixed(1)}% → ${(current.averageScore * 100).toFixed(1)}% (${scoreDelta >= 0 ? "+" : ""}${(scoreDelta * 100).toFixed(1)}%)`,
    `Cost: $${baseline.totalCostUsd.toFixed(4)} → $${current.totalCostUsd.toFixed(4)}`,
    improved ? "IMPROVED" : scoreDelta === 0 ? "NO CHANGE" : "REGRESSED",
  ].join("\n");

  return { improved, passRateDelta, scoreDelta, details };
}

// ── Result Persistence ──────────────────────────────────────────────────────

/** Save an eval suite result to disk. */
export function saveResult(result: EvalSuiteResult): string {
  const dir = getResultsDir();
  const filePath = path.join(dir, `${result.suiteId}-${result.timestamp}.json`);
  atomicWriteJSON(filePath, result);
  return filePath;
}

/** Load all saved eval results, newest first. */
export function loadResults(): EvalSuiteResult[] {
  const dir = getResultsDir();
  if (!fs.existsSync(dir)) return [];

  const results: EvalSuiteResult[] = [];
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
      results.push(JSON.parse(content) as EvalSuiteResult);
    } catch {
      // Skip malformed
    }
  }

  return results.sort((a, b) => b.timestamp - a.timestamp);
}
