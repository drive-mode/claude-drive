/**
 * governance/scan.ts — Orchestrates the full governance scan workflow.
 * Coordinates: projectGraph -> entropy -> taskLedger -> artifacts.
 * Ported from cursor-drive for Node.js.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { writeJsonAtomic } from "../fsUtils.js";
import { buildProjectGraphSnapshot } from "./projectGraph.js";
import { computeEntropyReport, renderEntropyMarkdown } from "./entropy.js";
import { generateTaskLedger, renderWorkboardMarkdown, writeTaskLedger } from "./taskLedger.js";
import { ensureGovernanceDirs } from "./paths.js";
import { validateScanResult } from "./schemas.js";
import type { GovernanceScanResult } from "./types.js";

/** Run a full governance scan on the given workspace root. */
export async function runGovernanceScan(rootDir: string): Promise<GovernanceScanResult> {
  const warnings: string[] = [];

  // Ensure standard governance directory layout exists
  const govPaths = await ensureGovernanceDirs(rootDir);

  // 1. Build project graph
  const snapshot = await buildProjectGraphSnapshot(rootDir);
  const srcCount = snapshot.files.filter((f) => f.kind === "src").length;
  if (srcCount === 0) {
    warnings.push("No source files found — entropy metrics will be zero.");
  }

  // 2. Compute entropy
  const report = await computeEntropyReport(rootDir, snapshot);

  // 3. Generate task ledger
  const ledger = generateTaskLedger(report.findings);

  // 4. Write artifacts to standard directories

  // Snapshot JSON
  const snapshotPath = path.join(govPaths.snapshots, "latest.json");
  await writeJsonAtomic(snapshotPath, snapshot);

  // Entropy report (JSON + Markdown)
  const reportJsonPath = path.join(govPaths.reports, "entropy-latest.json");
  await writeJsonAtomic(reportJsonPath, report);

  const reportMdPath = path.join(govPaths.reports, "entropy-latest.md");
  const md = renderEntropyMarkdown(report);
  await fs.writeFile(reportMdPath, md, "utf-8");

  // Task ledger
  await writeTaskLedger(rootDir, ledger);

  // Workboard Markdown
  const workboardPath = path.join(govPaths.reports, "workboard-latest.md");
  await fs.writeFile(workboardPath, renderWorkboardMarkdown(ledger), "utf-8");

  // Append to NDJSON history
  const historyPath = path.join(govPaths.history, "scan.ndjson");
  const historyLine = JSON.stringify({
    score: report.score,
    findingCount: report.findings.length,
    taskCount: ledger.tasks.length,
    timestamp: report.timestamp,
  });
  await fs.appendFile(historyPath, historyLine + "\n", "utf-8");

  const result: GovernanceScanResult = {
    entropyScore: report.score,
    taskCount: ledger.tasks.length,
    warnings,
    reportPath: reportMdPath,
  };

  // Validate before returning
  return validateScanResult(result);
}
