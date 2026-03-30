/**
 * governance/focusGuard.ts — Validates operators stayed within declared scope.
 * Checks files touched by an operator against their task description to detect
 * scope creep. Uses simple heuristic matching (no AI call required).
 * Ported from cursor-drive for Node.js.
 */

import type { Finding } from "./types.js";

export interface FocusGuardInput {
  operatorName: string;
  task: string;
  filesTouched: string[];
}

export interface FocusGuardResult {
  inScope: boolean;
  outOfScopeFiles: string[];
  findings: Finding[];
}

/**
 * Extract likely-relevant path keywords from a task description.
 * E.g. "fix auth bug in login module" → ["auth", "login"]
 */
function extractTaskKeywords(task: string): string[] {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s/._-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Filter out common stop words
  const stopWords = new Set([
    "the", "and", "for", "that", "this", "with", "from", "have", "been",
    "will", "can", "should", "would", "could", "add", "fix", "update",
    "create", "make", "implement", "refactor", "remove", "delete", "change",
    "modify", "write", "read", "check", "test", "debug", "build", "run",
    "use", "get", "set", "all", "new", "old", "file", "files", "code",
  ]);

  return words.filter((w) => !stopWords.has(w));
}

/**
 * Check if a file path is likely relevant to the task keywords.
 * Matches against path segments and file names.
 */
function isLikelyRelevant(filePath: string, keywords: string[]): boolean {
  const lower = filePath.toLowerCase();
  // Always allow config, test, and type definition files
  if (/\.(test|spec)\.[jt]sx?$/.test(lower)) return true;
  if (/types?\.[jt]sx?$/.test(lower)) return true;
  if (/(package\.json|tsconfig|\.eslint|\.prettier)/i.test(lower)) return true;

  // Check if any keyword appears in the path
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Evaluate whether an operator stayed within task scope.
 * Returns findings for any out-of-scope files touched.
 */
export function evaluateFocusGuard(input: FocusGuardInput): FocusGuardResult {
  const { operatorName, task, filesTouched } = input;

  if (!task || filesTouched.length === 0) {
    return { inScope: true, outOfScopeFiles: [], findings: [] };
  }

  const keywords = extractTaskKeywords(task);
  if (keywords.length === 0) {
    // If we can't extract keywords, don't flag anything
    return { inScope: true, outOfScopeFiles: [], findings: [] };
  }

  const outOfScope = filesTouched.filter((f) => !isLikelyRelevant(f, keywords));

  const findings: Finding[] = outOfScope.map((f) => ({
    category: "focus" as const,
    severity: outOfScope.length > 3 ? "high" as const : "medium" as const,
    file: f,
    message: `${operatorName} touched ${f} which may be outside task scope: "${task}"`,
  }));

  return {
    inScope: outOfScope.length === 0,
    outOfScopeFiles: outOfScope,
    findings,
  };
}
