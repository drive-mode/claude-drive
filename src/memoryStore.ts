/**
 * memoryStore.ts — Typed, persistent memory store for claude-drive.
 * Replaces the simple string[] sliding window with structured memory entries
 * that support typed kinds, confidence decay, cross-operator sharing, and queries.
 */
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { getConfig } from "./config.js";
import { atomicWriteJSON } from "./atomicWrite.js";

export type MemoryKind = "fact" | "preference" | "correction" | "decision" | "context";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string;                // operator name or "system"
  operatorId?: string;           // undefined = global/shared
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  confidence: number;            // 0.0-1.0, decays over time
  supersededBy?: string;         // id of entry that replaced this one
  expiresAt?: number;            // optional TTL
}

export interface MemoryQuery {
  kinds?: MemoryKind[];
  tags?: string[];
  operatorId?: string | null;    // null = global only, undefined = all
  search?: string;               // substring match on content
  limit?: number;
  includeExpired?: boolean;
}

export interface MemoryStats {
  total: number;
  byKind: Record<MemoryKind, number>;
  byOperator: Record<string, number>;
}

const MEMORY_FILE = path.join(os.homedir(), ".claude-drive", "memory.json");

export class MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const data = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) as MemoryEntry[];
        for (const e of data) this.entries.set(e.id, e);
      }
    } catch {
      this.entries = new Map();
    }
    this.loaded = true;
  }

  flush(): void {
    try {
      const dir = path.dirname(MEMORY_FILE);
      fs.mkdirSync(dir, { recursive: true });
      atomicWriteJSON(MEMORY_FILE, [...this.entries.values()]);
    } catch (e) {
      console.error("[memoryStore] Failed to flush:", e);
    }
  }

  add(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "accessCount">): MemoryEntry {
    this.ensureLoaded();
    const maxEntries = getConfig<number>("memory.maxEntries") ?? 500;
    if (this.entries.size >= maxEntries) {
      this.pruneOldest(Math.ceil(maxEntries * 0.1));
    }
    const now = Date.now();
    const full: MemoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    };
    this.entries.set(full.id, full);
    this.flush();
    return full;
  }

  get(id: string): MemoryEntry | undefined {
    this.ensureLoaded();
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessCount++;
      entry.updatedAt = Date.now();
    }
    return entry;
  }

  query(q: MemoryQuery): MemoryEntry[] {
    this.ensureLoaded();
    const now = Date.now();
    let results = [...this.entries.values()];

    if (!q.includeExpired) {
      results = results.filter((e) => !e.expiresAt || e.expiresAt > now);
    }
    // Exclude superseded entries
    results = results.filter((e) => !e.supersededBy);

    if (q.kinds && q.kinds.length > 0) {
      results = results.filter((e) => q.kinds!.includes(e.kind));
    }
    if (q.tags && q.tags.length > 0) {
      results = results.filter((e) => q.tags!.some((t) => e.tags.includes(t)));
    }
    if (q.operatorId === null) {
      results = results.filter((e) => !e.operatorId);
    } else if (q.operatorId !== undefined) {
      results = results.filter((e) => e.operatorId === q.operatorId || !e.operatorId);
    }
    if (q.search) {
      const lower = q.search.toLowerCase();
      results = results.filter((e) => e.content.toLowerCase().includes(lower));
    }

    // Sort: corrections first, then by confidence desc, then by recency
    results.sort((a, b) => {
      const kindOrder: Record<MemoryKind, number> = { correction: 0, decision: 1, fact: 2, preference: 3, context: 4 };
      const ka = kindOrder[a.kind] ?? 5;
      const kb = kindOrder[b.kind] ?? 5;
      if (ka !== kb) return ka - kb;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.updatedAt - a.updatedAt;
    });

    if (q.limit) {
      results = results.slice(0, q.limit);
    }
    return results;
  }

  update(id: string, patch: Partial<Pick<MemoryEntry, "content" | "confidence" | "tags" | "supersededBy" | "expiresAt">>): boolean {
    this.ensureLoaded();
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (patch.content !== undefined) entry.content = patch.content;
    if (patch.confidence !== undefined) entry.confidence = patch.confidence;
    if (patch.tags !== undefined) entry.tags = patch.tags;
    if (patch.supersededBy !== undefined) entry.supersededBy = patch.supersededBy;
    if (patch.expiresAt !== undefined) entry.expiresAt = patch.expiresAt;
    entry.updatedAt = Date.now();
    this.flush();
    return true;
  }

  remove(id: string): boolean {
    this.ensureLoaded();
    const ok = this.entries.delete(id);
    if (ok) this.flush();
    return ok;
  }

  getForOperator(operatorId: string, limit = 20): MemoryEntry[] {
    return this.query({ operatorId, limit });
  }

  getShared(limit = 20): MemoryEntry[] {
    return this.query({ operatorId: null, limit });
  }

  /** Get all entries (for export/dream). */
  getAll(): MemoryEntry[] {
    this.ensureLoaded();
    return [...this.entries.values()];
  }

  /** Bulk set entries (for import). */
  importBulk(entries: MemoryEntry[]): void {
    this.ensureLoaded();
    for (const e of entries) this.entries.set(e.id, e);
    this.flush();
  }

  stats(): MemoryStats {
    this.ensureLoaded();
    const byKind: Record<string, number> = {};
    const byOperator: Record<string, number> = {};
    for (const e of this.entries.values()) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      const opKey = e.operatorId ?? "shared";
      byOperator[opKey] = (byOperator[opKey] ?? 0) + 1;
    }
    return { total: this.entries.size, byKind: byKind as Record<MemoryKind, number>, byOperator };
  }

  /** Remove the oldest, lowest-confidence entries. */
  private pruneOldest(count: number): void {
    const sorted = [...this.entries.values()].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence - b.confidence;
      return a.updatedAt - b.updatedAt;
    });
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      this.entries.delete(sorted[i].id);
    }
  }
}

/** Singleton memory store instance. */
export const memoryStore = new MemoryStore();
