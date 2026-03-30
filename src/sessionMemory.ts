/**
 * sessionMemory.ts — In-session memory for operators and decisions.
 * Adapted from cursor-drive for Node.js, using store-based persistence.
 *
 * This module tracks:
 * - Turns (agent outputs/summaries)
 * - Tasks (active work items)
 * - Pending actions (user-mentioned follow-ups)
 * - Decisions (key operator insights)
 * - Compaction summaries (compressed old context)
 *
 * Visibility modes:
 * - isolated: only entries from this operator
 * - shared: all entries (default)
 * - collaborative: all entries with other operators' decisions labelled
 *
 * Compaction happens at 80% capacity, preserving decisions and task counts.
 *
 * Config defaults (add to ~/.claude-drive/config.json):
 *   "sessionMemory.maxEntries": 50
 *   "sessionMemory.tokenBudget": 500
 */

import fs from "fs";
import path from "path";
import os from "os";
import { getConfig } from "./config.js";

export type OperatorVisibility = "isolated" | "shared" | "collaborative";

export interface MemoryEntry {
  type: "turn" | "task" | "pending" | "decision" | "compaction-summary";
  content: string;
  /** Operator ID or name that produced this entry. */
  agent?: string;
  timestamp: number;
}

export interface SessionMemoryState {
  entries: MemoryEntry[];
  activeTasks: string[];
  pendingActions: string[];
}

const STORE_FILE = path.join(os.homedir(), ".claude-drive", "session-memory.json");
const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_TOKEN_BUDGET = 500; // characters as proxy for tokens
/** Compact when entries reach this fraction of maxEntries. */
const COMPACTION_THRESHOLD = 0.8;

/**
 * Load state from persistent store.
 */
function loadState(): SessionMemoryState {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      const content = fs.readFileSync(STORE_FILE, "utf-8");
      return JSON.parse(content) as SessionMemoryState;
    }
  } catch {
    // Fall through to default
  }
  return { entries: [], activeTasks: [], pendingActions: [] };
}

/**
 * Persist state to disk.
 */
function saveState(state: SessionMemoryState): void {
  try {
    fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.error("[sessionMemory] Failed to persist state:", e);
  }
}

export class SessionMemory {
  private state: SessionMemoryState;
  private maxEntries: number;
  private tokenBudget: number;

  constructor() {
    this.maxEntries = getConfig<number>("sessionMemory.maxEntries") ?? DEFAULT_MAX_ENTRIES;
    this.tokenBudget = getConfig<number>("sessionMemory.tokenBudget") ?? DEFAULT_TOKEN_BUDGET;
    this.state = loadState();
  }

  addTurn(summary: string, agent?: string): void {
    this.push({ type: "turn", content: summary, agent, timestamp: Date.now() });
  }

  /**
   * Update an existing turn by index (0 = oldest). Used when clarification
   * refactors the conversation instead of appending.
   */
  updateTurn(index: number, newContent: string): boolean {
    if (index < 0 || index >= this.state.entries.length) {
      return false;
    }
    const entry = this.state.entries[index];
    if (entry.type !== "turn") {
      return false;
    }
    entry.content = newContent;
    entry.timestamp = Date.now();
    this.persist();
    return true;
  }

  /** Index of the most recent turn, or -1 if none. */
  getLastTurnIndex(): number {
    for (let i = this.state.entries.length - 1; i >= 0; i--) {
      if (this.state.entries[i].type === "turn") {
        return i;
      }
    }
    return -1;
  }

  addTask(task: string): void {
    if (!this.state.activeTasks.includes(task)) {
      this.state.activeTasks.push(task);
      this.persist();
    }
  }

  completeTask(task: string): void {
    this.state.activeTasks = this.state.activeTasks.filter((t) => t !== task);
    this.persist();
  }

  addPendingAction(action: string): void {
    if (!this.state.pendingActions.includes(action)) {
      this.state.pendingActions.push(action);
      this.push({ type: "pending", content: action, timestamp: Date.now() });
    }
  }

  resolvePendingAction(action: string): void {
    this.state.pendingActions = this.state.pendingActions.filter((a) => a !== action);
    this.persist();
  }

  addDecision(decision: string, agent?: string): void {
    this.push({ type: "decision", content: decision, agent, timestamp: Date.now() });
  }

  // ── Context building ──────────────────────────────────────────────────────

  /**
   * Build a context string from all entries (shared/global view).
   */
  buildContextString(): string {
    return this.buildContextStringFromEntries(this.state.entries);
  }

  /**
   * Build a context string scoped to a specific operator.
   *
   * - `isolated`: only entries attributed to this operator's ID or name.
   * - `shared`: all entries.
   * - `collaborative`: all entries; explicitly marks other operators' decisions
   *   with attribution so the operator knows whose insight it is.
   */
  buildContextForOperator(operatorId: string, visibility: OperatorVisibility): string {
    if (visibility === "isolated") {
      const filtered = this.state.entries.filter((e) => e.agent === operatorId);
      return this.buildContextStringFromEntries(filtered);
    }
    if (visibility === "collaborative") {
      // All entries, but decisions from other operators are labelled to preserve attribution.
      const relabelled = this.state.entries.map((e) => {
        if (e.type === "decision" && e.agent && e.agent !== operatorId) {
          return { ...e, content: `[${e.agent}] ${e.content}` };
        }
        return e;
      });
      return this.buildContextStringFromEntries(relabelled);
    }
    // shared: full view
    return this.buildContextString();
  }

  /**
   * Return a view object scoped to a given operator. Callers can use this
   * as a drop-in for the `sessionMemory` field in DriveContext when routing
   * prompts on behalf of a specific operator.
   */
  forOperator(
    operatorId: string,
    visibility: OperatorVisibility
  ): {
    buildContextString(): string;
    updateTurn?(index: number, content: string): boolean;
    getLastTurnIndex?(): number;
  } {
    return {
      buildContextString: () => this.buildContextForOperator(operatorId, visibility),
      updateTurn: (i, c) => this.updateTurn(i, c),
      getLastTurnIndex: () => this.getLastTurnIndex(),
    };
  }

  private buildContextStringFromEntries(entries: MemoryEntry[]): string {
    if (entries.length === 0 && this.state.activeTasks.length === 0) {
      return "";
    }

    const lines: string[] = [];

    if (this.state.activeTasks.length > 0) {
      lines.push(`Active tasks: ${this.state.activeTasks.join(", ")}.`);
    }

    if (this.state.pendingActions.length > 0) {
      lines.push(`Pending (you mentioned): ${this.state.pendingActions.join("; ")}.`);
    }

    // Most recent entries first, up to token budget.
    const recent = [...entries]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    let budget = this.tokenBudget - lines.join(" ").length;
    for (const entry of recent) {
      const line = entry.agent ? `[${entry.agent}] ${entry.content}` : entry.content;
      if (budget - line.length < 0) {
        break;
      }
      lines.push(line);
      budget -= line.length;
    }

    return lines.join("\n");
  }

  // ── Compaction ────────────────────────────────────────────────────────────

  /**
   * Compact old entries when the entry count reaches the compaction threshold.
   *
   * Strategy (pre-compaction flush inspired):
   * 1. Identify the oldest half of entries (the "cold" window).
   * 2. Extract all `decision` entries from the cold window — they are most
   *    valuable and must not be silently lost.
   * 3. Summarise the cold window into a single `compaction-summary` entry
   *    containing the extracted decisions + task counts.
   * 4. Replace the cold window with the summary entry.
   * 5. Drop `pending` entries older than the compaction boundary (resolved or stale).
   */
  compact(): void {
    const threshold = Math.floor(this.maxEntries * COMPACTION_THRESHOLD);
    if (this.state.entries.length < threshold) {
      return;
    }

    const coldCount = Math.floor(this.state.entries.length / 2);
    const cold = this.state.entries.slice(0, coldCount);
    const warm = this.state.entries.slice(coldCount);

    // Pre-compaction flush: extract decisions from the cold window.
    const decisions = cold
      .filter((e) => e.type === "decision")
      .map((e) => (e.agent ? `[${e.agent}] ${e.content}` : e.content));

    const tasks = cold
      .filter((e) => e.type === "task")
      .map((e) => e.content);

    const turns = cold.filter((e) => e.type === "turn").length;

    const parts: string[] = [];
    if (turns > 0) {
      parts.push(`${turns} earlier turn(s) compacted`);
    }
    if (tasks.length > 0) {
      parts.push(`tasks: ${tasks.join(", ")}`);
    }
    if (decisions.length > 0) {
      parts.push(`key decisions: ${decisions.join("; ")}`);
    }

    const summaryEntry: MemoryEntry = {
      type: "compaction-summary",
      content: `[Compacted context] ${parts.join(". ")}`,
      timestamp: Date.now(),
    };

    // Warm window: keep all except stale pending entries.
    const prunedWarm = warm.filter((e) => e.type !== "pending");

    this.state.entries = [summaryEntry, ...prunedWarm];
    this.persist();
  }

  clear(): void {
    this.state = { entries: [], activeTasks: [], pendingActions: [] };
    this.persist();
  }

  getState(): Readonly<SessionMemoryState> {
    return this.state;
  }

  private push(entry: MemoryEntry): void {
    this.state.entries.push(entry);

    // Trigger compaction before hard-capping to preserve decisions.
    const threshold = Math.floor(this.maxEntries * COMPACTION_THRESHOLD);
    if (this.state.entries.length >= threshold) {
      this.compact();
    }

    // Hard cap as safety net after compaction.
    if (this.state.entries.length > this.maxEntries) {
      this.state.entries = this.state.entries.slice(-this.maxEntries);
    }

    this.persist();
  }

  private persist(): void {
    saveState(this.state);
  }
}
