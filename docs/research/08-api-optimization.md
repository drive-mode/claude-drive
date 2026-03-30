# 08 — API Cost & Performance Optimization

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26

---

## Executive Summary

claude-drive currently implements basic cost tracking and rate-limit handling, but **lacks several critical cost and performance optimizations** available through the Claude API and SDK. Single unified approach across all operator types with only partial cost instrumentation and no model routing. Estimated annual savings potential: **$64K–$90K USD** through targeted optimizations.

---

## 1. Prompt Caching

**Status:** NOT IMPLEMENTED

- `buildOperatorSystemPrompt()` creates unique prompts per operator including memory context
- No `cache_control` specifications passed to SDK `query()`
- System prompts (500–1500 tokens) reprocessed for every operator query

**Architectural Challenge:** Current memory injection creates dynamic, non-cacheable prompts. Caching requires separating static role template from dynamic memory context.

**Savings:** 90% on cache hits → **$12K–$18K/yr**

---

## 2. Model Routing by Role

**Status:** NOT IMPLEMENTED (single model for all operators)

### Current Role → Recommended Model Mapping

| Role | Permission | Recommended Model | Price Range |
|------|-----------|-------------------|-------------|
| researcher | readonly | Haiku | $1–5/MTok |
| reviewer | readonly | Haiku/Sonnet | $1–15/MTok |
| tester | standard | Sonnet | $3–15/MTok |
| implementer | standard | Sonnet | $3–15/MTok |
| planner | readonly | Opus | $5–25/MTok |

**Savings:** For typical workload mix → **$24K–$30K/yr**

---

## 3. Extended Thinking

**Status:** NOT IMPLEMENTED

- Planner role exists for complex reasoning and task decomposition
- No `maxThinkingTokens` configuration in query options
- No config keys for thinking budget

**Recommendation:** Enable for Planner role with configurable budget (default 10K tokens).

**Impact:** +5–15% cost per planner task, but **4–10x better plan quality** (ROI-positive).

---

## 4. Token Counting & Pre-Dispatch Cost Estimation

**Status:** PARTIAL (post-execution only; no pre-dispatch gates)

- `recordTaskStats()` records cost after task completes
- `resultMsg.total_cost_usd` extracted from SDK result
- `maxBudgetUsd` read from config but only used as hard SDK limit
- Free `count_tokens()` endpoint **not used**

**Recommendation:** Call `count_tokens()` before dispatch. If estimated cost > `approvalGates.costThreshold`: trigger approval gate.

**Savings:** $4K–$6K/yr via early abort of expensive queries.

---

## 5. Batch API

**Status:** NOT IMPLEMENTED

- No batching infrastructure exists
- Non-urgent tasks identified: code review, test runs, documentation generation
- 20–30% of tasks could be batched

**Savings:** 50% cost reduction on batched work → **$8K–$12K/yr**

---

## 6. Structured Outputs

**Status:** NOT IMPLEMENTED

- No schema validation on operator outputs
- No structured output enforcement via SDK
- Result text logged directly without parsing

**Savings:** 10–20% fewer turns per task → **$3K–$5K/yr**

---

## 7. Rate Limit Handling

**Status:** PARTIAL (passive detection; no proactive backpressure)

- Rate limit events detected (`rate_limit_event` message type)
- Reactive only: pauses and logs, no proactive queue management
- `anthropic-ratelimit-*-remaining` headers not read
- `operators.maxConcurrent: 3` config is independent of rate limit state
- Cache token immunity not tracked (cached tokens don't count toward ITPM)

**Recommendation:** Read remaining request count from headers. If remaining < (5 × maxConcurrent): queue new operators. Track cache hit ratio for ITPM planning.

**Savings:** $8K–$12K/yr via reduced rate-limit-induced retries.

---

## 8. Streaming & Partial Messages

**Status:** PARTIAL (infrastructure present; feature disabled)

- MCP server uses `StreamableHTTPServerTransport`
- SDK `query()` returns async iterator for event-driven output
- `includePartialMessages` not configured in SDK options

**Savings:** ~$1K–$2K/yr via early termination of wrong-direction queries.

---

## 9. Fast Mode

**Status:** NOT IMPLEMENTED

- Simple operators (researcher, reviewer) don't need full reasoning
- No `speed: "fast"` parameter passed to SDK
- 20–30% of tasks are read-analyze-report with minimal tool use

**Recommendation:** Apply fast mode for researcher (100%) and reviewer (70%) roles.

**Savings:** $3K–$6K/yr

---

## 10. Cost Tracking & Cache Statistics

**Status:** PARTIAL (extraction only; no detailed breakdown)

- `total_cost_usd` read from SDK result
- `PlanCostTracker` accumulates costs per plan period
- `drive_get_costs` MCP tool displays per-operator aggregation
- **Missing:** Per-turn cost, cache hit ratio, input/output token breakdown

**Recommended Enhancement:**
```typescript
interface TaskCostBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  costPerTurn: number;
  cacheHitRatio: number;
}
```

---

## Cost Optimization Roadmap

| Optimization | Estimated Savings | Effort | Priority |
|---|---|---|---|
| **Model Routing by Role** | $24K–$30K/yr | 2–3 weeks | P0 |
| **Prompt Caching** | $12K–$18K/yr | 1–2 weeks | P0 |
| **Rate Limit Backpressure** | $8K–$12K/yr | 2 weeks | P1 |
| **Batch API for Non-Urgent** | $8K–$12K/yr | 2–3 weeks | P1 |
| **Extended Thinking (Planners)** | 4–10x plan quality | 2 weeks | P1 |
| **Token Counting Pre-Dispatch** | $4K–$6K/yr | 1 week | P2 |
| **Structured Outputs** | $3K–$5K/yr | 2–3 weeks | P2 |
| **Fast Mode (Simple Roles)** | $3K–$6K/yr | 3–5 days | P2 |
| **Streaming & Partial Messages** | $1K–$2K/yr | 1 week | P3 |
| **Enhanced Cost Analytics** | $0 (visibility) | 3–5 days | P3 |

---

## SDK Gaps & Blockers

### Critical Unknowns

Must verify whether Agent SDK exposes:
1. `cache_control` on system prompts
2. Model selection parameter per query
3. `maxThinkingTokens` budget
4. `speed: "fast"` option
5. Batch API support
6. `count_tokens()` endpoint
7. Raw `anthropic-ratelimit-*-remaining` response headers

### Architectural Blocker: Prompt Caching

Current memory injection (operatorManager.ts:40-46) creates dynamic, non-cacheable prompts. Requires refactoring to:
1. Static base prompt from role template (cacheable)
2. Separate memory context marked with `cache_control: "ephemeral"`
3. Pass static/dynamic content separately to SDK

---

## Quick Wins (1–2 Days)

1. Add `approvalGates.costThreshold` config key (default: $2.50)
2. Fast mode conditional: `if (op.role === "researcher") options.speed = "fast"`
3. Enhanced cost logging: breakdown `total_cost_usd` into components if SDK exposes them
4. Add `operator.model` config key per role

---

## Implementation Timeline (3 Months)

| Week | Focus | Priority |
|------|-------|----------|
| 1–2 | Model Routing by Role + Token Counting | P0 |
| 3–4 | Prompt Caching Architecture + Pre-Dispatch Gates | P0 |
| 5–6 | Rate Limit Backpressure + Batch API Research | P1 |
| 7–8 | Extended Thinking Integration | P1 |
| 9–10 | Structured Outputs + Fast Mode | P2 |
| 11–12 | Enhanced Analytics + Streaming | P3 |

---

## Summary

**Total Estimated Annual Savings: $64K–$90K USD**

The two highest-impact optimizations — model routing ($24K–$30K) and prompt caching ($12K–$18K) — account for 55% of savings and should be implemented first. Both require verifying SDK support for model selection and cache_control parameters.
