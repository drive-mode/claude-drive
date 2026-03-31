import { jest } from "@jest/globals";
import type { Finding, TaskLedger } from "../../src/governance/types.js";

// Mock fs/promises for writeTaskLedger
const mockMkdir = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockWriteFile = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockRename = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.unstable_mockModule("fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  rename: mockRename,
  default: { mkdir: mockMkdir, writeFile: mockWriteFile, rename: mockRename },
}));

const { generateTaskLedger, renderWorkboardMarkdown, writeTaskLedger } =
  await import("../../src/governance/taskLedger.js");

describe("generateTaskLedger()", () => {
  it("creates tasks grouped by category from findings", () => {
    const findings: Finding[] = [
      { category: "dead_code", severity: "medium", file: "src/old.ts", message: "Unreachable: src/old.ts" },
      { category: "dead_code", severity: "low", file: "src/unused.ts", message: "Unreachable: src/unused.ts" },
      { category: "test_gaps", severity: "medium", file: "src/service.ts", message: "No test for service.ts" },
    ];

    const ledger = generateTaskLedger(findings);

    expect(ledger.tasks.length).toBe(2); // two categories: dead_code, test_gaps
    expect(ledger.generatedAt).toBeGreaterThan(0);

    const deadCodeTask = ledger.tasks.find((t) => t.category === "dead_code");
    expect(deadCodeTask).toBeDefined();
    expect(deadCodeTask!.title).toContain("2 findings");
    expect(deadCodeTask!.evidence.length).toBe(2);
    // Highest severity in dead_code group is "medium"
    expect(deadCodeTask!.priority).toBe("p1");
    expect(deadCodeTask!.effort).toBe("xs"); // dead_code → xs

    const testGapTask = ledger.tasks.find((t) => t.category === "test_gaps");
    expect(testGapTask).toBeDefined();
    expect(testGapTask!.evidence.length).toBe(1);
  });

  it("returns empty task list for empty findings", () => {
    const ledger = generateTaskLedger([]);

    expect(ledger.tasks).toEqual([]);
    expect(ledger.generatedAt).toBeGreaterThan(0);
  });

  it("sorts tasks by priority (p0 first)", () => {
    const findings: Finding[] = [
      { category: "todo_density", severity: "low", message: "5 TODOs in file" },
      { category: "dead_code", severity: "high", file: "src/a.ts", message: "dead code" },
      { category: "test_gaps", severity: "medium", message: "missing tests" },
    ];

    const ledger = generateTaskLedger(findings);

    expect(ledger.tasks.length).toBe(3);
    expect(ledger.tasks[0].priority).toBe("p0"); // high → p0
    expect(ledger.tasks[1].priority).toBe("p1"); // medium → p1
    expect(ledger.tasks[2].priority).toBe("p2"); // low → p2
  });

  it("assigns correct effort levels per category", () => {
    const categories: Finding["category"][] = [
      "dead_code", "redundancy", "test_gaps", "todo_density",
      "abstraction", "dependency_depth", "focus",
    ];

    const findings: Finding[] = categories.map((cat) => ({
      category: cat,
      severity: "medium" as const,
      message: `finding in ${cat}`,
    }));

    const ledger = generateTaskLedger(findings);

    const effortMap = new Map(ledger.tasks.map((t) => [t.category, t.effort]));
    expect(effortMap.get("dead_code")).toBe("xs");
    expect(effortMap.get("redundancy")).toBe("m");
    expect(effortMap.get("test_gaps")).toBe("m");
    expect(effortMap.get("todo_density")).toBe("s");
    expect(effortMap.get("abstraction")).toBe("l");
    expect(effortMap.get("dependency_depth")).toBe("l");
    expect(effortMap.get("focus")).toBe("s");
  });

  it("generates sequential task IDs", () => {
    const findings: Finding[] = [
      { category: "dead_code", severity: "low", message: "a" },
      { category: "test_gaps", severity: "low", message: "b" },
      { category: "redundancy", severity: "low", message: "c" },
    ];

    const ledger = generateTaskLedger(findings);
    const ids = ledger.tasks.map((t) => t.id);

    // IDs should be task-001, task-002, task-003 (order may vary due to sort)
    expect(ids).toContain("task-001");
    expect(ids).toContain("task-002");
    expect(ids).toContain("task-003");
  });
});

describe("renderWorkboardMarkdown()", () => {
  it("renders a Markdown workboard from a ledger", () => {
    const findings: Finding[] = [
      { category: "dead_code", severity: "high", file: "src/a.ts", message: "dead" },
      { category: "test_gaps", severity: "medium", message: "no tests" },
    ];
    const ledger = generateTaskLedger(findings);
    const md = renderWorkboardMarkdown(ledger);

    expect(md).toContain("# Governance Workboard");
    expect(md).toContain("Tasks: 2");
    expect(md).toContain("P0");
    expect(md).toContain("P1");
    expect(md).toContain("**Evidence:**");
  });

  it("renders empty workboard when no tasks", () => {
    const ledger = generateTaskLedger([]);
    const md = renderWorkboardMarkdown(ledger);

    expect(md).toContain("# Governance Workboard");
    expect(md).toContain("Tasks: 0");
  });
});

describe("writeTaskLedger()", () => {
  beforeEach(() => {
    mockMkdir.mockReset();
    mockWriteFile.mockReset();
    mockRename.mockReset();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("writes ledger JSON to disk", async () => {
    const ledger: TaskLedger = {
      tasks: [
        {
          id: "task-001",
          title: "Remove dead code (1 findings)",
          priority: "p1",
          effort: "xs",
          category: "dead_code",
          evidence: ["dead file"],
        },
      ],
      generatedAt: Date.now(),
    };

    const result = await writeTaskLedger("/project", ledger);

    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalled();
    expect(result).toContain("latest.json");
  });
});
