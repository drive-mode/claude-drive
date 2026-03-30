/**
 * governance/taskLedger.ts — Converts entropy findings into actionable tasks.
 * Append-only task log with timestamps, operators, and status.
 * Ported from cursor-drive for Node.js.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type {
  Finding,
  Task,
  TaskLedger,
  TaskPriority,
  TaskEffort,
  FindingCategory,
} from "./types.js";

const LEDGER_DIR = ".drive/governance/tasks";

function severityToPriority(severity: Finding["severity"]): TaskPriority {
  switch (severity) {
    case "high": return "p0";
    case "medium": return "p1";
    case "low": return "p2";
  }
}

function estimateEffort(finding: Finding): TaskEffort {
  switch (finding.category) {
    case "dead_code": return "xs"; // just delete
    case "redundancy": return "m"; // needs investigation
    case "test_gaps": return "m"; // write tests
    case "todo_density": return "s"; // resolve TODOs
    case "abstraction": return "l"; // refactor
    case "dependency_depth": return "l"; // restructure
    case "focus": return "s"; // revert or move
    default: return "m";
  }
}

function categoryTitle(cat: FindingCategory): string {
  switch (cat) {
    case "dead_code": return "Remove dead code";
    case "redundancy": return "Deduplicate";
    case "test_gaps": return "Add test coverage";
    case "todo_density": return "Resolve TODOs";
    case "abstraction": return "Simplify abstractions";
    case "dependency_depth": return "Flatten dependency chains";
    case "focus": return "Address scope creep";
    default: return "Address finding";
  }
}

/** Generate a task ledger from entropy findings. */
export function generateTaskLedger(findings: Finding[]): TaskLedger {
  // Group findings by category
  const byCategory = new Map<FindingCategory, Finding[]>();
  for (const f of findings) {
    const arr = byCategory.get(f.category) ?? [];
    arr.push(f);
    byCategory.set(f.category, arr);
  }

  const tasks: Task[] = [];
  let idCounter = 1;

  for (const [category, catFindings] of byCategory) {
    // One task per category, with all evidence rolled up
    const highestSeverity = catFindings.reduce<Finding["severity"]>(
      (max, f) => {
        const order = { high: 3, medium: 2, low: 1 };
        return order[f.severity] > order[max] ? f.severity : max;
      },
      "low"
    );

    tasks.push({
      id: `task-${String(idCounter++).padStart(3, "0")}`,
      title: `${categoryTitle(category)} (${catFindings.length} findings)`,
      priority: severityToPriority(highestSeverity),
      effort: estimateEffort(catFindings[0]),
      category,
      evidence: catFindings.map((f) => f.message),
    });
  }

  // Sort by priority (p0 first)
  tasks.sort((a, b) => a.priority.localeCompare(b.priority));

  return { tasks, generatedAt: Date.now() };
}

/** Render a task ledger as a Markdown workboard. */
export function renderWorkboardMarkdown(ledger: TaskLedger): string {
  const lines = [
    `# Governance Workboard`,
    ``,
    `Generated: ${new Date(ledger.generatedAt).toISOString()}`,
    `Tasks: ${ledger.tasks.length}`,
    ``,
  ];

  for (const priority of ["p0", "p1", "p2"] as TaskPriority[]) {
    const tasks = ledger.tasks.filter((t) => t.priority === priority);
    if (tasks.length === 0) continue;
    lines.push(`## ${priority.toUpperCase()} — ${priorityLabel(priority)}`);
    lines.push(``);
    for (const t of tasks) {
      lines.push(`### ${t.id}: ${t.title}`);
      lines.push(`- **Effort:** ${t.effort} | **Category:** ${t.category}`);
      lines.push(`- **Evidence:**`);
      for (const e of t.evidence.slice(0, 5)) {
        lines.push(`  - ${e}`);
      }
      if (t.evidence.length > 5) {
        lines.push(`  - ... and ${t.evidence.length - 5} more`);
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

function priorityLabel(p: TaskPriority): string {
  switch (p) {
    case "p0": return "Critical";
    case "p1": return "Important";
    case "p2": return "Nice to have";
  }
}

/** Write the task ledger to disk. */
export async function writeTaskLedger(
  rootDir: string,
  ledger: TaskLedger
): Promise<string> {
  const dir = path.join(rootDir, LEDGER_DIR);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "latest.json");
  await fs.writeFile(filePath, JSON.stringify(ledger, null, 2), "utf-8");
  return filePath;
}
