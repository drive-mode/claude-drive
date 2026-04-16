/**
 * memoryManager.ts — High-level memory operations for claude-drive.
 * Composes MemoryStore calls and provides the interface used by MCP tools
 * and the operator system prompt builder.
 */
import { memoryStore } from "./memoryStore.js";
import type { MemoryEntry, MemoryKind, MemoryQuery } from "./memoryStore.js";
import { getConfig } from "./config.js";

/** Store a typed memory entry for an operator. */
export function remember(
  operatorId: string,
  kind: MemoryKind,
  content: string,
  tags: string[] = [],
  source?: string
): MemoryEntry {
  const confidence = getConfig<number>("memory.defaultConfidence") ?? 0.8;
  return memoryStore.add({
    kind,
    content,
    source: source ?? operatorId,
    operatorId,
    tags,
    confidence,
  });
}

/** Query memory visible to an operator (operator-scoped + shared). */
export function recall(operatorId?: string, query?: MemoryQuery): MemoryEntry[] {
  return memoryStore.query({
    ...query,
    operatorId: operatorId ?? query?.operatorId,
  });
}

/** Supersede an existing memory entry with corrected content. */
export function correct(operatorId: string, oldId: string, newContent: string): MemoryEntry | undefined {
  const old = memoryStore.get(oldId);
  if (!old) return undefined;

  const replacement = memoryStore.add({
    kind: "correction",
    content: newContent,
    source: operatorId,
    operatorId: old.operatorId,
    tags: [...old.tags, "correction"],
    confidence: 1.0,
  });

  memoryStore.update(oldId, { supersededBy: replacement.id });
  return replacement;
}

/** Remove a memory entry. */
export function forget(id: string): boolean {
  return memoryStore.remove(id);
}

/** Promote an operator-scoped entry to shared/global. */
export function shareMemory(entryId: string): boolean {
  const entry = memoryStore.get(entryId);
  if (!entry) return false;
  // Clear operatorId to make it global
  const raw = memoryStore.getAll().find((e) => e.id === entryId);
  if (raw) {
    raw.operatorId = undefined;
    raw.updatedAt = Date.now();
    memoryStore.flush();
  }
  return true;
}

/**
 * Build a formatted memory context string for injection into an operator's system prompt.
 * Prioritizes: corrections > decisions > recent facts > preferences > context.
 */
export function buildMemoryContext(operatorId: string, maxEntries = 15): string {
  const entries = memoryStore.query({ operatorId, limit: maxEntries });
  if (entries.length === 0) return "";

  const lines: string[] = ["\nContext from memory:"];
  for (const e of entries) {
    const tag = e.kind === "correction" ? "[CORRECTION]"
      : e.kind === "decision" ? "[DECISION]"
      : e.kind === "preference" ? "[PREF]"
      : e.kind === "fact" ? "[FACT]"
      : "[CTX]";
    const shared = e.operatorId ? "" : " (shared)";
    lines.push(`  ${tag}${shared} ${e.content}`);
  }
  return lines.join("\n");
}

/** Export all memory entries (for session snapshots). */
export function exportAll(): MemoryEntry[] {
  return memoryStore.getAll();
}

/** Import memory entries in bulk (for session restore). */
export function importBulk(entries: MemoryEntry[]): void {
  memoryStore.importBulk(entries);
}

/**
 * Import an SDK `system/memory_recall` event into the local memory store as
 * low-confidence `context`-kind entries. Each recalled memory becomes one entry,
 * tagged with its scope (`personal`/`team`) and the mode (`select`/`synthesize`).
 *
 * Returns the freshly-added entries.
 */
export function importSdkMemoryEvent(
  operatorId: string,
  event: {
    mode?: "select" | "synthesize";
    memories?: Array<{ path: string; scope?: string; content?: string }>;
  },
): MemoryEntry[] {
  if (!event || !Array.isArray(event.memories)) return [];
  const added: MemoryEntry[] = [];
  const baseConfidence = Math.max(
    0,
    Math.min(1, (getConfig<number>("memory.defaultConfidence") ?? 0.8) * 0.75),
  );
  for (const m of event.memories) {
    const content = m.content?.trim() || `memory_recall: ${m.path}`;
    added.push(
      memoryStore.add({
        kind: "context",
        content,
        source: "sdk:memory_recall",
        operatorId,
        tags: ["sdk-memory", ...(m.scope ? [m.scope] : []), ...(event.mode ? [event.mode] : [])],
        confidence: baseConfidence,
      }),
    );
  }
  return added;
}
