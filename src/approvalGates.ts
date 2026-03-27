/**
 * approvalGates.ts — Approval gate policy for claude-drive.
 * Ported from cursor-drive/src/approvalGates.ts: removed vscode deps.
 * Uses getConfig() instead of vscode.workspace.getConfiguration.
 */
import { getConfig } from "./config.js";

export type GateAction = "allow" | "log" | "warn" | "block";

export interface GateResult {
  action: GateAction;
  reason?: string;
  pattern?: string;
}

export interface SteeringStats {
  totalChecks: number;
  actionCounts: Record<GateAction, number>;
  operatorActionCounts: Map<string, Record<GateAction, number>>;
  recentBlocks: Array<{ pattern: string; timestamp: number; operatorId?: string }>;
}

const stats: SteeringStats = {
  totalChecks: 0,
  actionCounts: { allow: 0, log: 0, warn: 0, block: 0 },
  operatorActionCounts: new Map(),
  recentBlocks: [],
};

const MAX_RECENT_BLOCKS = 50;

export function getSteeringStats(): Readonly<SteeringStats> {
  return stats;
}

export interface ThrottleStatus {
  throttled: boolean;
  reason?: string;
  warnCount: number;
  blockCount: number;
}

export function getThrottleStatus(operatorId: string): ThrottleStatus {
  const opStats = stats.operatorActionCounts.get(operatorId);
  if (!opStats) {
    return { throttled: false, warnCount: 0, blockCount: 0 };
  }
  const { warn: warnCount, block: blockCount } = opStats;
  if (blockCount >= 3) {
    return { throttled: true, reason: "Operator has been blocked 3+ times this session", warnCount, blockCount };
  }
  if (warnCount >= 5) {
    return { throttled: true, reason: "Operator has triggered 5+ warnings this session", warnCount, blockCount };
  }
  return { throttled: false, warnCount, blockCount };
}

export function resetOperatorStats(operatorId: string): void {
  stats.operatorActionCounts.delete(operatorId);
}

function recordAction(action: GateAction, pattern?: string, operatorId?: string): void {
  stats.totalChecks++;
  stats.actionCounts[action]++;
  // Track per-operator stats — use "anonymous" for empty/missing operatorId
  // to prevent throttle bypass via empty string
  const opKey = operatorId && operatorId.trim() ? operatorId : "anonymous";
  let opStats = stats.operatorActionCounts.get(opKey);
  if (!opStats) {
    opStats = { allow: 0, log: 0, warn: 0, block: 0 };
    stats.operatorActionCounts.set(opKey, opStats);
  }
  opStats[action]++;
  if ((action === "block" || action === "warn") && pattern) {
    stats.recentBlocks.push({ pattern, timestamp: Date.now(), operatorId });
    if (stats.recentBlocks.length > MAX_RECENT_BLOCKS) stats.recentBlocks.shift();
  }
}

export const DEFAULT_WARN_PATTERNS: RegExp[] = [
  /\brevert\b/i,
  /undo\s+all/i,
  /hard\s+reset/i,
  /reset\s+--hard/i,
  /force\s+push/i,
  /push\s+--force/i,
  /push\s+-f\b/i,
  /delete\s+branch/i,
  /drop\s+database/i,
  /drop\s+table/i,
];

export const DEFAULT_BLOCK_PATTERNS: RegExp[] = [
  /rm\s+-rf/i,
  /del\s+\/f\s+\/s\s+\/q/i,
  /format\s+c:/i,
  /rmdir\s+\/s/i,
];

export const DEFAULT_LOG_PATTERNS: RegExp[] = [
  /sudo\b/i,
  /npm\s+publish/i,
  /git\s+push/i,
];

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => {
    try { return new RegExp(p, "i"); } catch { return null; }
  }).filter((r): r is RegExp => r !== null);
}

function getGateConfig() {
  const enabled = getConfig<boolean>("approvalGates.enabled") ?? true;
  const extraBlock = getConfig<string[]>("approvalGates.blockPatterns") ?? [];
  const extraWarn = getConfig<string[]>("approvalGates.warnPatterns") ?? [];
  const extraLog = getConfig<string[]>("approvalGates.logPatterns") ?? [];
  return {
    enabled,
    blockPatterns: [...DEFAULT_BLOCK_PATTERNS, ...compilePatterns(extraBlock)],
    warnPatterns: [...DEFAULT_WARN_PATTERNS, ...compilePatterns(extraWarn)],
    logPatterns: [...DEFAULT_LOG_PATTERNS, ...compilePatterns(extraLog)],
  };
}

export function getGateResult(text: string, operatorId?: string): GateResult {
  const { enabled, blockPatterns, warnPatterns, logPatterns } = getGateConfig();
  if (!enabled) {
    recordAction("allow", undefined, operatorId);
    return { action: "allow" };
  }

  for (const re of blockPatterns) {
    const m = text.match(re);
    if (m) {
      recordAction("block", m[0], operatorId);
      return { action: "block", reason: "blocked by safety policy", pattern: m[0] };
    }
  }

  for (const re of warnPatterns) {
    const m = text.match(re);
    if (m) {
      recordAction("warn", m[0], operatorId);
      return { action: "warn", reason: "potentially destructive operation", pattern: m[0] };
    }
  }

  for (const re of logPatterns) {
    const m = text.match(re);
    if (m) {
      recordAction("log", m[0], operatorId);
      return { action: "log", reason: "notable operation logged", pattern: m[0] };
    }
  }

  recordAction("allow", undefined, operatorId);
  return { action: "allow" };
}
