/**
 * governance/scan.ts — Orchestrates the full governance scan workflow.
 * Coordinates: projectGraph → entropy → taskLedger → artifacts.
 * Ported from cursor-drive for Node.js.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { buildProjectGraphSnapshot } from "./projectGraph.js";
import { computeEntropyReport, renderEntropyMarkdown } from "./entropy.js";
import { generateTaskLedger, renderWorkboardMarkdown, writeTaskLedger } from "./taskLedger.js";
import type { GovernanceScanResult } from "./types.js";

const GOV_DIR = ".drive/governance";

/** Run a full governance scan on the given workspace root. */
export async function runGovernanceScan(rootDir: string): Promise<GovernanceScanResult> {
  const warnings: string[] = [];

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

  // 4. Write artifacts
  const govDir = path.join(rootDir, GOV_DIR);
  await fs.mkdir(path.join(govDir, "snapshots"), { recursive: true });
  await fs.mkdir(path.join(govDir, "reports"), { recursive: true });

  // Snapshot JSON
  const snapshotPath = path.join(govDir, "snapshots", "latest.json");
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

  // Entropy report (JSON + Markdown)
  const reportJsonPath = path.join(govDir, "reports", "entropy-latest.json");
  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");

  const reportMdPath = path.join(govDir, "reports", "entropy-latest.md");
  const md = renderEntropyMarkdown(report);
  await fs.writeFile(reportMdPath, md, "utf-8");

  // Task ledger
  await writeTaskLedger(rootDir, ledger);

  // Workboard Markdown
  const workboardPath = path.join(govDir, "reports", "workboard-latest.md");
  await fs.writeFile(workboardPath, renderWorkboardMarkdown(ledger), "utf-8");

  // Append to NDJSON history
  const historyPath = path.join(govDir, "history.ndjson");
  const historyLine = JSON.stringify({
    score: report.score,
    findingCount: report.findings.length,
    taskCount: ledger.tasks.length,
    timestamp: report.timestamp,
  });
  await fs.appendFile(historyPath, historyLine + "\n", "utf-8");

  return {
    entropyScore: report.score,
    taskCount: ledger.tasks.length,
    warnings,
    reportPath: reportMdPath,
  };
}
