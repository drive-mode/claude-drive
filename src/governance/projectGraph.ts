/**
 * governance/projectGraph.ts — Build a snapshot of project structure.
 * Extracts imports/exports, LOC, and file kinds from TypeScript files.
 * Ported from cursor-drive (pure Node.js, no VS Code deps).
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { FileNode, ProjectGraphSnapshot } from "./types.js";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "out", "dist", "build", ".drive",
  "coverage", ".next", ".cache", "__pycache__",
]);

const SRC_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const TEST_PATTERNS = [/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /__tests__/];

function classifyFile(relPath: string): FileNode["kind"] {
  if (TEST_PATTERNS.some((re) => re.test(relPath))) return "test";
  if (/\.(md|mdx|txt|rst)$/i.test(relPath)) return "doc";
  if (/plan/i.test(relPath) && /\.(md|txt)$/i.test(relPath)) return "plan";
  if (/\.(json|ya?ml|toml|ini|env)$/i.test(relPath)) return "config";
  if (SRC_EXTENSIONS.has(path.extname(relPath))) return "src";
  return "other";
}

const IMPORT_RE = /(?:import|from)\s+['"](\.[\w./\\-]+)['"]/g;
const EXPORT_RE = /export\s+(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;

function extractImportsExports(content: string): { imports: string[]; exports: string[] } {
  const imports: string[] = [];
  const exports: string[] = [];
  for (const m of content.matchAll(IMPORT_RE)) imports.push(m[1]);
  for (const m of content.matchAll(EXPORT_RE)) exports.push(m[1]);
  return { imports, exports };
}

async function walk(dir: string, rootDir: string): Promise<FileNode[]> {
  const nodes: FileNode[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return nodes;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        nodes.push(...await walk(full, rootDir));
      }
    } else if (entry.isFile()) {
      const relPath = path.relative(rootDir, full);
      const kind = classifyFile(relPath);
      let loc = 0;
      let imports: string[] = [];
      let exports: string[] = [];
      if (SRC_EXTENSIONS.has(path.extname(entry.name))) {
        try {
          const content = await fs.readFile(full, "utf-8");
          loc = content.split("\n").filter((l) => l.trim()).length;
          ({ imports, exports } = extractImportsExports(content));
        } catch { /* skip unreadable files */ }
      }
      nodes.push({ path: relPath, kind, loc, imports, exports });
    }
  }
  return nodes;
}

/** Build a full project graph snapshot. */
export async function buildProjectGraphSnapshot(rootDir: string): Promise<ProjectGraphSnapshot> {
  const files = await walk(rootDir, rootDir);
  return { files, timestamp: Date.now() };
}
