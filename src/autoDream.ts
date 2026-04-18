/**
 * autoDream.ts — Background memory consolidation daemon for claude-drive.
 * Periodically reviews memory, prunes stale entries, decays confidence,
 * merges similar entries, and promotes cross-operator patterns to shared.
 */
import { memoryStore } from "./memoryStore.js";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

export interface DreamResult {
  pruned: number;
  merged: number;
  promoted: number;
  demoted: number;
  summary: string;
  timestamp: number;
}

export interface DreamConfig {
  enabled: boolean;
  intervalMs: number;
  minEntriesForDream: number;
  pruneThreshold: number;
  mergeThreshold: number;
  maxAgeMs: number;
}

function getDefaultConfig(): DreamConfig {
  return {
    enabled: getConfig<boolean>("dream.enabled") ?? true,
    intervalMs: getConfig<number>("dream.intervalMs") ?? 900_000,    // 15 minutes
    minEntriesForDream: getConfig<number>("dream.minEntries") ?? 10,
    pruneThreshold: getConfig<number>("dream.pruneThreshold") ?? 0.2,
    mergeThreshold: getConfig<number>("dream.mergeThreshold") ?? 0.7,
    maxAgeMs: getConfig<number>("dream.maxAgeMs") ?? 604_800_000,     // 7 days
  };
}

/** Calculate simple keyword overlap similarity between two strings. */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/** Run a single dream consolidation cycle. */
export function runDreamCycle(configOverride?: Partial<DreamConfig>): DreamResult {
  const config = { ...getDefaultConfig(), ...configOverride };
  const now = Date.now();
  const entries = memoryStore.getAll();

  if (entries.length < config.minEntriesForDream) {
    return { pruned: 0, merged: 0, promoted: 0, demoted: 0, summary: "Too few entries to dream.", timestamp: now };
  }

  let pruned = 0;
  let merged = 0;
  let promoted = 0;
  let demoted = 0;

  // 1. Prune: remove expired and very low confidence entries
  for (const e of entries) {
    if (e.supersededBy) continue; // already handled
    const expired = e.expiresAt && e.expiresAt < now;
    const tooLow = e.confidence < config.pruneThreshold;
    if (expired || tooLow) {
      memoryStore.remove(e.id);
      pruned++;
    }
  }

  // 2. Decay: reduce confidence of entries not accessed recently
  const decayHalfLife = getConfig<number>("memory.decayHalfLifeHours") ?? 168;
  const decayEnabled = getConfig<boolean>("memory.decayEnabled") ?? true;
  const remaining = memoryStore.getAll().filter((e) => !e.supersededBy);

  if (decayEnabled) {
    for (const e of remaining) {
      const ageHours = (now - e.updatedAt) / (1000 * 60 * 60);
      if (ageHours > 1) {
        const decayFactor = Math.pow(0.5, ageHours / decayHalfLife);
        const newConfidence = Math.max(0.05, e.confidence * decayFactor);
        if (newConfidence < e.confidence - 0.01) {
          memoryStore.update(e.id, { confidence: Math.round(newConfidence * 1000) / 1000 });
          demoted++;
        }
      }
    }
  }

  // 3. Merge: find entries with high content overlap
  const active = memoryStore.getAll().filter((e) => !e.supersededBy && !e.expiresAt);
  const mergedIds = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    if (mergedIds.has(active[i].id)) continue;
    for (let j = i + 1; j < active.length; j++) {
      if (mergedIds.has(active[j].id)) continue;
      if (active[i].kind !== active[j].kind) continue;

      const sim = similarity(active[i].content, active[j].content);
      if (sim >= config.mergeThreshold) {
        // Keep the newer one, supersede the older
        const [keep, discard] = active[i].updatedAt >= active[j].updatedAt
          ? [active[i], active[j]]
          : [active[j], active[i]];
        memoryStore.update(discard.id, { supersededBy: keep.id });
        // Boost the kept entry's confidence slightly
        memoryStore.update(keep.id, {
          confidence: Math.min(1.0, keep.confidence + 0.1),
        });
        mergedIds.add(discard.id);
        merged++;
      }
    }
  }

  // 4. Promote: if an operator-scoped fact appears across 2+ operators, promote to shared
  const operatorEntries = memoryStore.getAll().filter((e) => e.operatorId && !e.supersededBy);
  const contentMap = new Map<string, Set<string>>();
  for (const e of operatorEntries) {
    const key = e.content.toLowerCase().trim();
    if (!contentMap.has(key)) contentMap.set(key, new Set());
    contentMap.get(key)!.add(e.operatorId!);
  }

  for (const [content, operators] of contentMap) {
    if (operators.size >= 2) {
      // Find the entry with highest confidence and promote it
      const candidates = operatorEntries.filter(
        (e) => e.content.toLowerCase().trim() === content && !e.supersededBy
      );
      const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      if (best && best.operatorId) {
        // Clear operatorId to make shared
        const raw = memoryStore.getAll().find((e) => e.id === best.id);
        if (raw) {
          raw.operatorId = undefined;
          raw.updatedAt = now;
          // Supersede the other copies
          for (const c of candidates) {
            if (c.id !== best.id) {
              memoryStore.update(c.id, { supersededBy: best.id });
            }
          }
          promoted++;
        }
      }
    }
  }

  memoryStore.flush();

  const parts: string[] = [];
  if (pruned) parts.push(`pruned ${pruned}`);
  if (merged) parts.push(`merged ${merged}`);
  if (promoted) parts.push(`promoted ${promoted}`);
  if (demoted) parts.push(`decayed ${demoted}`);
  const summary = parts.length > 0 ? `Dream cycle: ${parts.join(", ")}.` : "Dream cycle: no changes.";

  return { pruned, merged, promoted, demoted, summary, timestamp: now };
}

// ── Daemon ───────────────────────────────────────────────────────────────────

export class AutoDreamDaemon {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastResult: DreamResult | null = null;
  private running = false;

  start(): void {
    const config = getDefaultConfig();
    if (!config.enabled) return;
    if (this.timer) return;

    this.running = true;
    this.timer = setInterval(() => {
      this.lastResult = runDreamCycle();
      if (this.lastResult.pruned || this.lastResult.merged || this.lastResult.promoted) {
        logger.info(`[auto-dream] ${this.lastResult.summary}`);
      }
    }, config.intervalMs);

    // Run initial cycle after a brief delay
    setTimeout(() => {
      if (this.running) {
        this.lastResult = runDreamCycle();
        if (this.lastResult.pruned || this.lastResult.merged || this.lastResult.promoted) {
          logger.info(`[auto-dream] ${this.lastResult.summary}`);
        }
      }
    }, 5000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  runOnce(): DreamResult {
    this.lastResult = runDreamCycle();
    return this.lastResult;
  }

  getLastResult(): DreamResult | null {
    return this.lastResult;
  }

  isRunning(): boolean {
    return this.running;
  }
}
