import { jest } from "@jest/globals";
import type { ProjectGraphSnapshot, FileNode, EntropyReport } from "../../src/governance/types.js";

// Mock fs/promises so computeEntropyReport never touches disk (TODO density reads files)
const mockReadFile = jest.fn<(path: string, enc: string) => Promise<string>>();
jest.unstable_mockModule("fs/promises", () => ({
  readFile: mockReadFile,
  default: { readFile: mockReadFile },
}));

const { computeEntropyReport, renderEntropyMarkdown } = await import(
  "../../src/governance/entropy.js"
);

function makeFile(overrides: Partial<FileNode> & Pick<FileNode, "path">): FileNode {
  return {
    kind: "src",
    loc: 50,
    imports: [],
    exports: [],
    ...overrides,
  };
}

function makeSnapshot(files: FileNode[]): ProjectGraphSnapshot {
  return { files, timestamp: Date.now() };
}

describe("computeEntropyReport()", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    // Default: files have no TODO markers
    mockReadFile.mockResolvedValue("const x = 1;\n");
  });

  it("returns a valid report with score and metrics", async () => {
    const snapshot = makeSnapshot([
      makeFile({ path: "src/cli.ts", imports: [], exports: ["main"] }),
      makeFile({ path: "src/config.ts", imports: ["./types"], exports: ["getConfig"] }),
      makeFile({ path: "src/types.ts", imports: [], exports: ["Config"] }),
    ]);

    const report = await computeEntropyReport("/fake", snapshot);

    expect(report).toHaveProperty("score");
    expect(report).toHaveProperty("metrics");
    expect(report).toHaveProperty("findings");
    expect(report).toHaveProperty("timestamp");
    expect(typeof report.score).toBe("number");
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("computes higher entropy for scattered / ungoverned code", async () => {
    // Many unconnected files with no tests and no imports between them
    const scattered = makeSnapshot([
      makeFile({ path: "src/a.ts", loc: 100, imports: [], exports: ["a"] }),
      makeFile({ path: "src/b.ts", loc: 100, imports: [], exports: ["b"] }),
      makeFile({ path: "src/c.ts", loc: 100, imports: [], exports: ["c"] }),
      makeFile({ path: "src/d.ts", loc: 100, imports: [], exports: ["d"] }),
      makeFile({ path: "src/e.ts", loc: 100, imports: [], exports: ["e"] }),
    ]);

    // Focused project: entry imports everything, all have tests, low exports/LOC
    const focused = makeSnapshot([
      makeFile({ path: "src/index.ts", loc: 500, imports: ["./config", "./service"], exports: ["start"] }),
      makeFile({ path: "src/config.ts", loc: 500, imports: [], exports: ["getConfig"] }),
      makeFile({ path: "src/service.ts", loc: 500, imports: ["./config"], exports: ["serve"] }),
      makeFile({ path: "tests/config.test.ts", kind: "test", loc: 50, imports: [], exports: [] }),
      makeFile({ path: "tests/service.test.ts", kind: "test", loc: 50, imports: [], exports: [] }),
      makeFile({ path: "tests/index.test.ts", kind: "test", loc: 50, imports: [], exports: [] }),
    ]);

    const scatteredReport = await computeEntropyReport("/fake", scattered);
    const focusedReport = await computeEntropyReport("/fake", focused);

    // Scattered has dead code, no tests, high entropy
    // Focused has no dead code, full test coverage, low entropy
    expect(scatteredReport.score).toBeGreaterThanOrEqual(focusedReport.score);
  });

  it("returns low entropy for a single entry-point file", async () => {
    const snapshot = makeSnapshot([
      makeFile({ path: "src/index.ts", loc: 500, imports: [], exports: ["main"] }),
      makeFile({ path: "src/__tests__/index.test.ts", kind: "test", loc: 50, imports: [], exports: [] }),
    ]);

    const report = await computeEntropyReport("/fake", snapshot);
    // index.ts is an entry point so deadCodeRatio should be 0
    expect(report.metrics.deadCodeRatio).toBe(0);
    // __tests__/index.test.ts -> src/index which matches src/index.ts stem
    expect(report.metrics.testGapIndex).toBe(0);
  });

  it("returns zero metrics for empty snapshot", async () => {
    const snapshot = makeSnapshot([]);
    const report = await computeEntropyReport("/fake", snapshot);

    expect(report.score).toBe(0);
    expect(report.metrics.deadCodeRatio).toBe(0);
    expect(report.metrics.redundancy).toBe(0);
    expect(report.metrics.testGapIndex).toBe(0);
    expect(report.metrics.todoDensity).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("detects TODO density when source files contain markers", async () => {
    mockReadFile.mockResolvedValue(
      "// TODO: fix this\nconst x = 1;\n// FIXME: broken\n// HACK: workaround\n"
    );

    const snapshot = makeSnapshot([
      makeFile({ path: "src/messy.ts", loc: 4, imports: [], exports: ["x"] }),
    ]);

    const report = await computeEntropyReport("/fake", snapshot);
    expect(report.metrics.todoDensity).toBeGreaterThan(0);
  });

  it("detects test gaps for src files without corresponding tests", async () => {
    const snapshot = makeSnapshot([
      makeFile({ path: "src/service.ts", loc: 100, imports: [], exports: ["serve"] }),
      // No test file for service.ts
    ]);

    const report = await computeEntropyReport("/fake", snapshot);
    expect(report.metrics.testGapIndex).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.category === "test_gaps")).toBe(true);
  });
});

describe("renderEntropyMarkdown()", () => {
  it("renders a valid Markdown string from a report", async () => {
    const snapshot = makeSnapshot([
      makeFile({ path: "src/index.ts", loc: 10, imports: [], exports: ["main"] }),
    ]);
    const report = await computeEntropyReport("/fake", snapshot);
    const md = renderEntropyMarkdown(report);

    expect(md).toContain("# Entropy Report");
    expect(md).toContain("**Score:**");
    expect(md).toContain("## Metrics");
    expect(md).toContain("Dead code ratio");
  });
});
