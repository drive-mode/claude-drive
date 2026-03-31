/**
 * costTracker.ts — Real-time per-operator API cost and token tracking.
 * Records usage from Agent SDK query() results and exposes session totals.
 */
import { getConfig } from "./config.js";

export interface OperatorCost {
  operatorId: string;
  operatorName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  requests: number;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ModelUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

// Default pricing (Sonnet 4 tier) — configurable via config
const DEFAULT_PRICING = {
  inputPerMToken: 3.0,
  outputPerMToken: 15.0,
  cacheReadPerMToken: 0.30,
  cacheCreationPerMToken: 3.75,
};

export class CostTracker {
  private costs = new Map<string, OperatorCost>();
  private sessionStart = Date.now();

  /** Record token usage from an SDK result for an operator. */
  record(operatorId: string, operatorName: string, usage: TokenUsage): void {
    if (!getConfig<boolean>("cost.tracking")) return;

    let entry = this.costs.get(operatorId);
    if (!entry) {
      entry = {
        operatorId,
        operatorName,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        requests: 0,
      };
      this.costs.set(operatorId, entry);
    }

    entry.inputTokens += usage.input_tokens ?? 0;
    entry.outputTokens += usage.output_tokens ?? 0;
    entry.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    entry.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    entry.requests += 1;
    entry.costUsd = this.computeCost(entry);
  }

  /** Record from the SDK's total_cost_usd + modelUsage (more accurate). */
  recordFromResult(
    operatorId: string,
    operatorName: string,
    totalCostUsd: number,
    modelUsage: Record<string, ModelUsageRecord>,
  ): void {
    if (!getConfig<boolean>("cost.tracking")) return;

    let entry = this.costs.get(operatorId);
    if (!entry) {
      entry = {
        operatorId,
        operatorName,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        requests: 0,
      };
      this.costs.set(operatorId, entry);
    }

    for (const mu of Object.values(modelUsage)) {
      entry.inputTokens += mu.inputTokens;
      entry.outputTokens += mu.outputTokens;
      entry.cacheReadTokens += mu.cacheReadInputTokens;
      entry.cacheCreationTokens += mu.cacheCreationInputTokens;
    }
    entry.requests += 1;
    // Use the SDK-reported cost directly — it's the most accurate
    entry.costUsd += totalCostUsd;
  }

  getOperatorCost(operatorId: string): OperatorCost | undefined {
    return this.costs.get(operatorId);
  }

  getAllCosts(): OperatorCost[] {
    return Array.from(this.costs.values());
  }

  getSessionTotal(): {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    sessionDurationMs: number;
  } {
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalRequests = 0;
    for (const entry of this.costs.values()) {
      totalCostUsd += entry.costUsd;
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;
      totalRequests += entry.requests;
    }
    return {
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      totalRequests,
      sessionDurationMs: Date.now() - this.sessionStart,
    };
  }

  reset(): void {
    this.costs.clear();
    this.sessionStart = Date.now();
  }

  serialize(): { operators: Record<string, OperatorCost>; sessionStart: number } {
    const operators: Record<string, OperatorCost> = {};
    for (const [id, cost] of this.costs) {
      operators[id] = { ...cost };
    }
    return { operators, sessionStart: this.sessionStart };
  }

  restore(data: { operators: Record<string, OperatorCost>; sessionStart: number }): void {
    this.sessionStart = data.sessionStart;
    this.costs.clear();
    for (const [id, cost] of Object.entries(data.operators)) {
      this.costs.set(id, { ...cost });
    }
  }

  private computeCost(entry: OperatorCost): number {
    const inputRate = getConfig<number>("cost.pricing.inputPerMToken") ?? DEFAULT_PRICING.inputPerMToken;
    const outputRate = getConfig<number>("cost.pricing.outputPerMToken") ?? DEFAULT_PRICING.outputPerMToken;
    const cacheReadRate = getConfig<number>("cost.pricing.cacheReadPerMToken") ?? DEFAULT_PRICING.cacheReadPerMToken;
    const cacheCreationRate = getConfig<number>("cost.pricing.cacheCreationPerMToken") ?? DEFAULT_PRICING.cacheCreationPerMToken;
    return (
      (entry.inputTokens / 1_000_000) * inputRate +
      (entry.outputTokens / 1_000_000) * outputRate +
      (entry.cacheReadTokens / 1_000_000) * cacheReadRate +
      (entry.cacheCreationTokens / 1_000_000) * cacheCreationRate
    );
  }
}
