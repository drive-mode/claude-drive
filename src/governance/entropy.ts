/**
 * governance/entropy.ts — Code quality metrics and entropy scoring.
 * Computes dead code ratio, redundancy, test gaps, TODO density,
 * abstraction index, and dependency chain depth.
 * Ported from cursor-drive (pure Node.js, no VS Code deps).
 */

import * as fs from "fs/promises";
import * as path from "path";
import type {
  ProjectGraphSnapshot,
  FileNode,
  EntropyMetrics,
  EntropyReport,
  Finding,
} from "./types.js";

// ── Individual metric computers ─────────────────────────────────────────────

/** Dead code = fraction of src files not imported by any other src file. */
function computeDeadCodeRatio(snapshot: ProjectGraphSnapshot): { ratio: number; findings: Finding[] } {
  const srcFiles = snapshot.files.filter((f) => f.kind === "src");
  if (srcFiles.length === 0) return { ratio: 0, findings: [] };

  const imported = new Set<string>();
  for (const f of srcFiles) {
    for (const imp of f.imports) {
      // Normalize import path to match file paths
      const resolved = imp.replace(/^\.\//, "").replace(/\.[jt]sx?$/, "");
      imported.add(resolved);
    }
  }

  const dead: FileNode[] = [];
  for (const f of srcFiles) {
    const stem = f.path.replace(/\.[jt]sx?$/, "");
    // Entry points and index files are never "dead"
    if (/(?:cli|index|main|server)/.test(f.path)) continue;
    if (!imported.has(stem) && !imported.has(stem.replace(/^src\//, ""))) {
      dead.push(f);
    }
  }

  const ratio = dead.length / srcFiles.length;
  const findings: Finding[] = dead.map((f) => ({
    category: "dead_code" as const,
    severity: "medium" as const,
    file: f.path,
    message: `Potentially unreachable: ${f.path} (${f.loc} LOC, not imported by any src file)`,
  }));
  return { ratio, findings };
}

/** Redundancy = fraction of files with identical content (same LOC + exports). */
function computeRedundancy(snapshot: ProjectGraphSnapshot): { ratio: number; findings: Finding[] } {
  const srcFiles = snapshot.files.filter((f) => f.kind === "src" && f.loc > 10);
  if (srcFiles.length === 0) return { ratio: 0, findings: [] };

  const fingerprints = new Map<string, FileNode[]>();
  for (const f of srcFiles) {
    const key = `${f.loc}:${f.exports.sort().join(",")}`;
    const arr = fingerprints.get(key) ?? [];
    arr.push(f);
    fingerprints.set(key, arr);
  }

  let duplicateCount = 0;
  const findings: Finding[] = [];
  for (const [, group] of fingerprints) {
    if (group.length > 1) {
      duplicateCount += group.length - 1;
      findings.push({
        category: "redundancy",
        severity: "low",
        message: `Possible duplicates (same LOC/exports): ${group.map((f) => f.path).join(", ")}`,
      });
    }
  }
  return { ratio: duplicateCount / srcFiles.length, findings };
}

/** Test gap = fraction of src files with no corresponding test file. */
function computeTestGapIndex(snapshot: ProjectGraphSnapshot): { ratio: number; findings: Finding[] } {
  const srcFiles = snapshot.files.filter((f) => f.kind === "src");
  const testFiles = snapshot.files.filter((f) => f.kind === "test");
  if (srcFiles.length === 0) return { ratio: 0, findings: [] };

  const testedStems = new Set(
    testFiles.map((f) =>
      f.path
        .replace(/\.(?:test|spec)\.[jt]sx?$/, "")
        .replace(/__tests__\//, "")
    )
  );

  const untested = srcFiles.filter((f) => {
    const stem = f.path.replace(/\.[jt]sx?$/, "");
    return !testedStems.has(stem);
  });

  const findings: Finding[] = untested
    .filter((f) => f.loc > 30) // only flag non-trivial files
    .map((f) => ({
      category: "test_gaps" as const,
      severity: "medium" as const,
      file: f.path,
      message: `No test file found for ${f.path} (${f.loc} LOC)`,
    }));

  return { ratio: untested.length / srcFiles.length, findings };
}

/** TODO density = count of TODO/FIXME per 1000 LOC. */
async function computeTodoDensity(
  rootDir: string,
  snapshot: ProjectGraphSnapshot
): Promise<{ density: number; findings: Finding[] }> {
  const srcFiles = snapshot.files.filter((f) => f.kind === "src");
  let totalLoc = 0;
  let todoCount = 0;
  const findings: Finding[] = [];

  for (const f of srcFiles) {
    totalLoc += f.loc;
    try {
      const content = await fs.readFile(path.join(rootDir, f.path), "utf-8");
      const matches = content.match(/\b(?:TODO|FIXME|HACK|XXX)\b/gi);
      if (matches && matches.length > 0) {
        todoCount += matches.length;
        if (matches.length >= 3) {
          findings.push({
            category: "todo_density",
            severity: "low",
            file: f.path,
            message: `${matches.length} TODO/FIXME markers in ${f.path}`,
          });
        }
      }
    } catch { /* skip unreadable */ }
  }

  const density = totalLoc > 0 ? (todoCount / totalLoc) * 1000 : 0;
  return { density, findings };
}

/** Abstraction index = ratio of exported symbols to total LOC (high = over-abstracted). */
function computeAbstractionIndex(snapshot: ProjectGraphSnapshot): number {
  const srcFiles = snapshot.files.filter((f) => f.kind === "src");
  const totalExports = srcFiles.reduce((sum, f) => sum + f.exports.length, 0);
  const totalLoc = srcFiles.reduce((sum, f) => sum + f.loc, 0);
  return totalLoc > 0 ? totalExports / totalLoc : 0;
}

/** Dependency chain depth = longest import chain (p95). */
function computeDepChainP95(snapshot: ProjectGraphSnapshot): number {
  const srcFiles = snapshot.files.filter((f) => f.kind === "src");
  const fileMap = new Map(srcFiles.map((f) => [f.path.replace(/\.[jt]sx?$/, ""), f]));

  function depthOf(stem: string, visited: Set<string>): number {
    if (visited.has(stem)) return 0;
    visited.add(stem);
    const node = fileMap.get(stem) ?? fileMap.get(`src/${stem}`);
    if (!node) return 0;
    let max = 0;
    for (const imp of node.imports) {
      const resolved = imp.replace(/^\.\//, "").replace(/\.[jt]sx?$/, "");
      max = Math.max(max, 1 + depthOf(resolved, visited));
    }
    return max;
  }

  const depths: number[] = [];
  for (const [stem] of fileMap) {
    depths.push(depthOf(stem, new Set()));
  }
  if (depths.length === 0) return 0;
  depths.sort((a, b) => a - b);
  return depths[Math.floor(depths.length * 0.95)] ?? 0;
}

// ── Composite entropy score ─────────────────────────────────────────────────

/**
 * Weighted entropy score (0-100, lower is better):
 * 25% dead code + 20% redundancy + 15% abstraction + 10% dep chain +
 * 15% test gaps + 10% churn (not computed, placeholder) + 5% TODO density
 */
function computeScore(metrics: EntropyMetrics): number {
  return Math.min(100, Math.round(
    metrics.deadCodeRatio * 25 * 100 +
    metrics.redundancy * 20 * 100 +
    metrics.abstractionIndex * 15 * 1000 + // scale since this is typically small
    Math.min(metrics.depChainP95 / 10, 1) * 10 * 100 +
    metrics.testGapIndex * 15 * 100 +
    Math.min(metrics.todoDensity / 20, 1) * 5 * 100
  ));
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function computeEntropyReport(
  rootDir: string,
  snapshot: ProjectGraphSnapshot
): Promise<EntropyReport> {
  const deadCode = computeDeadCodeRatio(snapshot);
  const redundancy = computeRedundancy(snapshot);
  const testGaps = computeTestGapIndex(snapshot);
  const todos = await computeTodoDensity(rootDir, snapshot);
  const abstractionIndex = computeAbstractionIndex(snapshot);
  const depChainP95 = computeDepChainP95(snapshot);

  const metrics: EntropyMetrics = {
    deadCodeRatio: deadCode.ratio,
    redundancy: redundancy.ratio,
    testGapIndex: testGaps.ratio,
    todoDensity: todos.density,
    abstractionIndex,
    depChainP95,
  };

  const findings = [
    ...deadCode.findings,
    ...redundancy.findings,
    ...testGaps.findings,
    ...todos.findings,
  ];

  return {
    score: computeScore(metrics),
    metrics,
    findings,
    timestamp: Date.now(),
  };
}

/** Render an entropy report as Markdown. */
export function renderEntropyMarkdown(report: EntropyReport): string {
  const m = report.metrics;
  const lines = [
    `# Entropy Report`,
    ``,
    `**Score:** ${report.score}/100 (lower is better)`,
    `**Generated:** ${new Date(report.timestamp).toISOString()}`,
    ``,
    `## Metrics`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Dead code ratio | ${(m.deadCodeRatio * 100).toFixed(1)}% |`,
    `| Redundancy | ${(m.redundancy * 100).toFixed(1)}% |`,
    `| Test gap index | ${(m.testGapIndex * 100).toFixed(1)}% |`,
    `| TODO density | ${m.todoDensity.toFixed(1)} per 1k LOC |`,
    `| Abstraction index | ${m.abstractionIndex.toFixed(3)} |`,
    `| Dep chain P95 | ${m.depChainP95} |`,
    ``,
  ];

  if (report.findings.length > 0) {
    lines.push(`## Findings (${report.findings.length})`);
    lines.push(``);
    for (const f of report.findings) {
      lines.push(`- **[${f.severity}]** ${f.message}`);
    }
  }

  return lines.join("\n");
}
