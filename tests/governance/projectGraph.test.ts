import { jest } from "@jest/globals";

// Mock fs/promises to avoid real disk I/O
const mockReaddir = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockReadFile = jest.fn<(...args: unknown[]) => Promise<string>>();

jest.unstable_mockModule("fs/promises", () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  default: { readdir: mockReaddir, readFile: mockReadFile },
}));

const { buildProjectGraphSnapshot } = await import(
  "../../src/governance/projectGraph.js"
);

/** Helper to create a mock Dirent-like object. */
function dirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

describe("buildProjectGraphSnapshot()", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  it("builds a graph from a simple file list", async () => {
    // Root dir has two files
    mockReaddir.mockResolvedValueOnce([
      dirent("config.ts", false),
      dirent("cli.ts", false),
    ]);
    mockReadFile.mockImplementation(async () =>
      'import { getConfig } from "./config.js";\nexport function main() {}\n'
    );

    const snapshot = await buildProjectGraphSnapshot("/fake");

    expect(snapshot.files.length).toBe(2);
    expect(snapshot).toHaveProperty("timestamp");
    expect(typeof snapshot.timestamp).toBe("number");
  });

  it("returns correct node count including subdirectory files", async () => {
    // Root: one file + one subdirectory
    mockReaddir.mockResolvedValueOnce([
      dirent("index.ts", false),
      dirent("utils", true),
    ]);
    // utils/ subdir: one file
    mockReaddir.mockResolvedValueOnce([
      dirent("helpers.ts", false),
    ]);
    mockReadFile.mockResolvedValue("export const a = 1;\n");

    const snapshot = await buildProjectGraphSnapshot("/fake");

    expect(snapshot.files.length).toBe(2);
    expect(snapshot.files.map((f) => f.path).sort()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("index.ts"),
        expect.stringContaining("helpers.ts"),
      ])
    );
  });

  it("extracts imports and exports from TypeScript source", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("service.ts", false),
    ]);
    mockReadFile.mockResolvedValue(
      'import { Config } from "./types.js";\nimport { log } from "./logger.js";\nexport function serve() {}\nexport const PORT = 3000;\n'
    );

    const snapshot = await buildProjectGraphSnapshot("/fake");

    const node = snapshot.files[0];
    expect(node.imports).toContain("./types.js");
    expect(node.imports).toContain("./logger.js");
    expect(node.exports).toContain("serve");
    expect(node.exports).toContain("PORT");
  });

  it("returns empty graph for empty file list", async () => {
    mockReaddir.mockResolvedValueOnce([]);

    const snapshot = await buildProjectGraphSnapshot("/fake");

    expect(snapshot.files).toEqual([]);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it("skips ignored directories like node_modules and .git", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("app.ts", false),
      dirent("node_modules", true),
      dirent(".git", true),
      dirent("out", true),
    ]);
    mockReadFile.mockResolvedValue("export const x = 1;\n");

    const snapshot = await buildProjectGraphSnapshot("/fake");

    // Only app.ts should appear, ignored dirs should not be traversed
    expect(snapshot.files.length).toBe(1);
    expect(snapshot.files[0].path).toContain("app.ts");
    // readdir should only be called once (for root), not for ignored dirs
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it("classifies test files correctly", async () => {
    mockReaddir.mockResolvedValueOnce([
      dirent("config.test.ts", false),
      dirent("app.spec.ts", false),
      dirent("main.ts", false),
    ]);
    mockReadFile.mockResolvedValue("export const x = 1;\n");

    const snapshot = await buildProjectGraphSnapshot("/fake");

    const testFiles = snapshot.files.filter((f) => f.kind === "test");
    const srcFiles = snapshot.files.filter((f) => f.kind === "src");
    expect(testFiles.length).toBe(2);
    expect(srcFiles.length).toBe(1);
  });

  it("handles readdir errors gracefully", async () => {
    mockReaddir.mockRejectedValueOnce(new Error("EACCES"));

    const snapshot = await buildProjectGraphSnapshot("/nonexistent");

    expect(snapshot.files).toEqual([]);
  });
});
