/**
 * persistentMemory.ts — Persistent Markdown memory system (two-layer model).
 * Adapted from cursor-drive for Node.js.
 *
 * Design:
 *   Layer 1 — curated: workspace/.drive/MEMORY.md (hand-edited or agent-written long-term facts)
 *   Layer 2 — daily log: workspace/.drive/memory/YYYY-MM-DD.md (append-only, auto-written)
 *
 * At session start, today's log + yesterday's log are loaded alongside the curated file.
 * Older logs are available via keyword search (simple BM25-lite).
 *
 * Usage:
 *   1. Instantiate with workspace root: new PersistentMemory(projectRoot)
 *   2. Call buildPromptContext() to get curated + daily logs for context injection
 *   3. Call appendToDaily() for decisions/key turns
 *   4. Call writeCurated() to update the long-term memory file
 *   5. Call search() for keyword-based retrieval of past logs
 */

import * as fs from "fs/promises";
import * as path from "path";

const DRIVE_DIR = ".drive";
const CURATED_FILE = "MEMORY.md";
const DAILY_DIR = "memory";

export interface MemorySearchResult {
  date: string;
  snippet: string;
  score: number;
}

export class PersistentMemory {
  private workspaceRoot: string;
  private driveDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.driveDir = path.join(workspaceRoot, DRIVE_DIR);
  }

  // ── File paths ───────────────────────────────────────────────────────────

  private curatedPath(): string {
    return path.join(this.driveDir, CURATED_FILE);
  }

  private dailyPath(date?: string): string {
    const d = date ?? isoDate();
    return path.join(this.driveDir, DAILY_DIR, `${d}.md`);
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Load curated memory + today's and yesterday's daily logs.
   * Returns concatenated Markdown suitable for injection into context.
   */
  async buildPromptContext(): Promise<string> {
    const parts: string[] = [];

    const curated = await readFileSafe(this.curatedPath());
    if (curated) {
      parts.push(`## Long-term memory\n\n${curated}`);
    }

    const today = isoDate();
    const yesterday = isoDate(-1);

    const todayLog = await readFileSafe(this.dailyPath(today));
    const yesterdayLog = await readFileSafe(this.dailyPath(yesterday));

    if (yesterdayLog) {
      parts.push(`## Yesterday (${yesterday})\n\n${yesterdayLog}`);
    }
    if (todayLog) {
      parts.push(`## Today (${today})\n\n${todayLog}`);
    }

    return parts.join("\n\n---\n\n");
  }

  /**
   * Read the curated MEMORY.md file.
   * Returns null if the file does not exist.
   */
  async readCurated(): Promise<string | null> {
    return readFileSafe(this.curatedPath());
  }

  // ── Write ────────────────────────────────────────────────────────────────

  /**
   * Append a note to today's daily log.
   * Prefixes with a timestamp for easy scanning.
   */
  async appendToDaily(note: string, agent?: string): Promise<void> {
    await fs.mkdir(path.join(this.driveDir, DAILY_DIR), { recursive: true });
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const prefix = agent ? `[${timestamp}] [${agent}]` : `[${timestamp}]`;
    const line = `${prefix} ${note.trim()}\n`;
    await fs.appendFile(this.dailyPath(), line, "utf8");
  }

  /**
   * Write (overwrite) the curated MEMORY.md. Typically called by the agent
   * during a pre-compaction flush or when the user says "remember this".
   */
  async writeCurated(content: string): Promise<void> {
    await fs.mkdir(this.driveDir, { recursive: true });
    await fs.writeFile(this.curatedPath(), content.trim() + "\n", "utf8");
  }

  // ── Search & Prune ────────────────────────────────────────────────────────

  /**
   * Delete daily log files older than the given number of days.
   */
  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    let deleted = 0;
    try {
      const dailyDir = path.join(this.driveDir, DAILY_DIR);
      const names = await fs.readdir(dailyDir);
      for (const n of names) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(n)) {
          continue;
        }
        if (n.replace(".md", "") < cutoffStr) {
          await fs.unlink(path.join(dailyDir, n));
          deleted++;
        }
      }
    } catch {
      // Directory may not exist
    }
    return deleted;
  }

  /**
   * Simple keyword search across daily log files (BM25-lite).
   * Scores files by term-frequency of query tokens; returns top results
   * with the matching snippet (up to 200 chars per match).
   */
  async search(query: string, topK = 5): Promise<MemorySearchResult[]> {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (tokens.length === 0) {
      return [];
    }

    let logFiles: string[];
    try {
      const dailyDir = path.join(this.driveDir, DAILY_DIR);
      const names = await fs.readdir(dailyDir);
      logFiles = names
        .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
        .sort()
        .reverse() // most recent first
        .slice(0, 30) // scan at most 30 days
        .map((n) => path.join(dailyDir, n));
    } catch {
      return [];
    }

    const results: MemorySearchResult[] = [];

    for (const filePath of logFiles) {
      const content = await readFileSafe(filePath);
      if (!content) {
        continue;
      }

      const lower = content.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        let pos = 0;
        while ((pos = lower.indexOf(token, pos)) !== -1) {
          score++;
          pos += token.length;
        }
      }

      if (score === 0) {
        continue;
      }

      // Extract first matching snippet.
      const firstToken = tokens.find((t) => lower.includes(t)) ?? tokens[0];
      const matchIdx = lower.indexOf(firstToken);
      const start = Math.max(0, matchIdx - 60);
      const snippet = content.slice(start, start + 200).replace(/\n/g, " ");
      const date = path.basename(filePath, ".md");
      results.push({ date, snippet, score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Return ISO date string (YYYY-MM-DD) for today + optional day offset. */
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
