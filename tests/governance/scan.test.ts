import { jest } from "@jest/globals";
import type {
  ProjectGraphSnapshot,
  EntropyReport,
  TaskLedger,
} from "../../src/governance/types.js";

// ── Mock all governance sub-modules and fs ─────────────────────────────────

const mockBuildProjectGraphSnapshot = jest.fn<
  (rootDir: string) => Promise<ProjectGraphSnapshot>
>();

const mockComputeEntropyReport = jest.fn<
  (rootDir: string, snapshot: ProjectGraphSnapshot) => Promise<EntropyReport>
>();
const mockRenderEntropyMarkdown = jest.fn<(report: EntropyReport) => string>();

const mockGenerateTaskLedger = jest.fn<
  (findings: EntropyReport["findings"]) => TaskLedger
>();
const mockRenderWorkboardMarkdown = jest.fn<(ledger: TaskLedger) => string>();
const mockWriteTaskLedger = jest.fn<
  (rootDir: string, ledger: TaskLedger) => Promise<string>
>();

const mockMkdir = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockWriteFile = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockAppendFile = jest.fn<(...args: unknown[]) => Promise<void>>();
const mockRename = jest.fn<(...args: unknown[]) => Promise<void>>();

jest.unstable_mockModule("fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  appendFile: mockAppendFile,
  rename: mockRename,
  default: { mkdir: mockMkdir, writeFile: mockWriteFile, appendFile: mockAppendFile, rename: mockRename },
}));

jest.unstable_mockModule("../../src/governance/projectGraph.js", () => ({
  buildProjectGraphSnapshot: mockBuildProjectGraphSnapshot,
}));

jest.unstable_mockModule("../../src/governance/entropy.js", () => ({
  computeEntropyReport: mockComputeEntropyReport,
  renderEntropyMarkdown: mockRenderEntropyMarkdown,
}));

jest.unstable_mockModule("../../src/governance/taskLedger.js", () => ({
  generateTaskLedger: mockGenerateTaskLedger,
  renderWorkboardMarkdown: mockRenderWorkboardMarkdown,
  writeTaskLedger: mockWriteTaskLedger,
}));

const { runGovernanceScan } = await import("../../src/governance/scan.js");

// ── Fixtures ───────────────────────────────────────────────────────────────

const FIXTURE_SNAPSHOT: ProjectGraphSnapshot = {
  files: [
    { path: "src/app.ts", kind: "src", loc: 50, imports: [], exports: ["main"] },
    { path: "src/config.ts", kind: "src", loc: 30, imports: [], exports: ["getConfig"] },
    { path: "tests/config.test.ts", kind: "test", loc: 20, imports: [], exports: [] },
  ],
  timestamp: 1000,
};

const FIXTURE_REPORT: EntropyReport = {
  score: 35,
  metrics: {
    deadCodeRatio: 0.1,
    redundancy: 0,
    testGapIndex: 0.5,
    todoDensity: 2,
    abstractionIndex: 0.01,
    depChainP95: 2,
  },
  findings: [
    {
      category: "test_gaps",
      severity: "medium",
      file: "src/app.ts",
      message: "No test for src/app.ts",
    },
  ],
  timestamp: 1000,
};

const FIXTURE_LEDGER: TaskLedger = {
  tasks: [
    {
      id: "task-001",
      title: "Add test coverage (1 findings)",
      priority: "p1",
      effort: "m",
      category: "test_gaps",
      evidence: ["No test for src/app.ts"],
    },
  ],
  generatedAt: 1000,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("runGovernanceScan()", () => {
  beforeEach(() => {
    mockBuildProjectGraphSnapshot.mockReset();
    mockComputeEntropyReport.mockReset();
    mockRenderEntropyMarkdown.mockReset();
    mockGenerateTaskLedger.mockReset();
    mockRenderWorkboardMarkdown.mockReset();
    mockWriteTaskLedger.mockReset();
    mockMkdir.mockReset();
    mockWriteFile.mockReset();
    mockAppendFile.mockReset();
    mockRename.mockReset();

    mockBuildProjectGraphSnapshot.mockResolvedValue(FIXTURE_SNAPSHOT);
    mockComputeEntropyReport.mockResolvedValue(FIXTURE_REPORT);
    mockRenderEntropyMarkdown.mockReturnValue("# Entropy Report\n");
    mockGenerateTaskLedger.mockReturnValue(FIXTURE_LEDGER);
    mockRenderWorkboardMarkdown.mockReturnValue("# Workboard\n");
    mockWriteTaskLedger.mockResolvedValue("/fake/.drive/governance/tasks/latest.json");
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockAppendFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("runs a full scan and returns a result", async () => {
    const result = await runGovernanceScan("/fake");

    expect(result).toHaveProperty("entropyScore");
    expect(result).toHaveProperty("taskCount");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("reportPath");
    expect(result.entropyScore).toBe(35);
    expect(result.taskCount).toBe(1);
  });

  it("produces an entropy report from the snapshot", async () => {
    await runGovernanceScan("/fake");

    expect(mockBuildProjectGraphSnapshot).toHaveBeenCalledWith("/fake");
    expect(mockComputeEntropyReport).toHaveBeenCalledWith("/fake", FIXTURE_SNAPSHOT);
  });

  it("produces task recommendations from findings", async () => {
    await runGovernanceScan("/fake");

    expect(mockGenerateTaskLedger).toHaveBeenCalledWith(FIXTURE_REPORT.findings);
  });

  it("writes all artifacts to disk", async () => {
    await runGovernanceScan("/fake");

    // Should create standard governance directories (root + 5 subdirs)
    expect(mockMkdir).toHaveBeenCalledTimes(6);
    // Should write snapshot JSON, report JSON, report MD, workboard MD
    expect(mockWriteFile).toHaveBeenCalledTimes(4);
    // Should append to history NDJSON
    expect(mockAppendFile).toHaveBeenCalledTimes(1);
    // Should write task ledger
    expect(mockWriteTaskLedger).toHaveBeenCalled();
  });

  it("warns when no source files are found", async () => {
    mockBuildProjectGraphSnapshot.mockResolvedValue({
      files: [
        { path: "README.md", kind: "doc", loc: 10, imports: [], exports: [] },
      ],
      timestamp: 1000,
    });

    const result = await runGovernanceScan("/empty-project");

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("No source files");
  });

  it("returns reportPath pointing to the entropy markdown", async () => {
    const result = await runGovernanceScan("/fake");

    expect(result.reportPath).toContain("entropy-latest.md");
  });
});
