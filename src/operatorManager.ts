/**
 * operatorManager.ts — Agent SDK wrapper for claude-drive operators.
 * Maps each OperatorContext to a query() call with appropriate tool permissions.
 */
import type {
  ContextUsage,
  EffortLevel,
  OperatorContext,
  OperatorRegistry,
  PermissionPreset,
} from "./operatorRegistry.js";
import type {
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
  SDKRateLimitEvent,
} from "@anthropic-ai/claude-agent-sdk";
import { logActivity, logFile, agentOutput } from "./agentOutput.js";
import { speak } from "./tts.js";
import { getConfig } from "./config.js";
import { buildMemoryContext, importSdkMemoryEvent } from "./memoryManager.js";
import { hookRegistry } from "./hooks.js";
import { writeProgressEvent } from "./progressFile.js";

// ── Tool permission mapping ─────────────────────────────────────────────────

const READONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"] as const;
const STANDARD_TOOLS = [...READONLY_TOOLS, "Edit", "Write", "Bash", "Agent"] as const;
const FULL_TOOLS = [...STANDARD_TOOLS] as const;

export function toolsForPreset(preset: PermissionPreset): string[] {
  switch (preset) {
    case "readonly": return [...READONLY_TOOLS];
    case "full":     return [...FULL_TOOLS];
    default:         return [...STANDARD_TOOLS];
  }
}

// ── System prompt builder ───────────────────────────────────────────────────

export function buildOperatorSystemPrompt(op: OperatorContext): string {
  const lines: string[] = [
    `You are operator "${op.name}" in a multi-agent coding session.`,
  ];
  if (op.role) {
    lines.push(`Your role: ${op.role}.`);
  }
  if (op.systemHint) {
    lines.push(op.systemHint);
  }
  // Structured memory (typed entries from memoryStore)
  const memCtx = buildMemoryContext(op.id);
  if (memCtx) {
    lines.push(memCtx);
  } else if (op.memory.length > 0) {
    // Fallback to legacy string[] memory for backward compat
    lines.push("\nContext from memory:");
    lines.push(...op.memory.slice(-10).map((m) => `  - ${m}`));
  }
  lines.push(
    "\nUse the claude-drive MCP tools to report progress:",
    "  agent_screen_activity — log what you are doing",
    "  agent_screen_file     — log files you touch",
    "  agent_screen_decision — log key decisions",
    "  tts_speak             — speak important updates aloud",
  );
  if (op.permissionPreset === "readonly") {
    lines.push("\nIMPORTANT: You have READ-ONLY permissions. Do not edit or create files.");
  }
  return lines.join("\n");
}

// ── Subagent definitions ────────────────────────────────────────────────────

export function buildSubagentDefs(
  operators: OperatorContext[]
): Record<string, { description: string; prompt: string; tools: string[] }> {
  const defs: Record<string, { description: string; prompt: string; tools: string[] }> = {};
  for (const op of operators) {
    defs[op.name] = {
      description: op.role
        ? `${op.role} operator${op.task ? `: ${op.task}` : ""}`
        : `Operator${op.task ? `: ${op.task}` : ""}`,
      prompt: buildOperatorSystemPrompt(op),
      tools: toolsForPreset(op.permissionPreset),
    };
  }
  return defs;
}

// ── SDK pre-warm (startup) ─────────────────────────────────────────────────

/** Module-scoped promise so startup() is called at most once per process. */
let startupPromise: Promise<void> | undefined;

/**
 * Ensure the Agent SDK is pre-warmed. Called before the first `query()` so the
 * first operator boots fast. Feature-detected — if the SDK does not expose
 * `startup()`, this is a no-op. Can be disabled with `operator.preWarm = false`.
 */
export async function ensureStartup(): Promise<void> {
  if (getConfig<boolean>("operator.preWarm") === false) return;
  if (startupPromise) return startupPromise;

  startupPromise = (async () => {
    try {
      const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
        startup?: (params?: { initializeTimeoutMs?: number }) => Promise<unknown>;
      };
      if (typeof sdk.startup === "function") {
        await sdk.startup({});
      }
    } catch (e) {
      // startup is a best-effort optimisation; never fail operator runs because of it
      console.warn("[operatorManager] startup() skipped:", e);
    }
  })();
  return startupPromise;
}

/** Test-only: reset the cached startup promise. */
export function __resetStartupPromise(): void {
  startupPromise = undefined;
}

// ── Run operator ────────────────────────────────────────────────────────────

export interface TaskResultStats {
  totalCostUsd: number;
  durationMs: number;
  apiDurationMs: number;
  numTurns: number;
}

export type OnTaskComplete = (op: OperatorContext, stats: TaskResultStats) => void;

export interface RunOperatorOptions {
  cwd?: string;
  mcpServerUrl?: string;
  maxTurns?: number;
  allOperators?: OperatorContext[];
  onTaskComplete?: OnTaskComplete;
  abortSignal?: AbortSignal;
  /** If true, dispatch detached and write progress events to disk. Caller is not expected to await. */
  isBackground?: boolean;
  /** Operator registry (enables context-usage + status updates). */
  registry?: OperatorRegistry;
  /** Per-run token budget (sent as `taskBudget: { total }` to the SDK). */
  taskBudget?: number;
  /** Effort / thinking depth for the SDK. */
  effort?: EffortLevel;
  /** Progress-file base directory override (test hook). */
  progressBaseDir?: string;
}

function resolveTaskBudget(opts: RunOperatorOptions): { total: number } | undefined {
  const v = opts.taskBudget ?? getConfig<number | undefined>("operator.taskBudget");
  if (typeof v === "number" && v > 0) return { total: v };
  return undefined;
}

function resolveEffort(op: OperatorContext, opts: RunOperatorOptions): EffortLevel | undefined {
  return opts.effort ?? op.effort ?? getConfig<EffortLevel | undefined>("operator.defaultEffort");
}

/**
 * Exposed for tests — builds the option object that is passed to `query()` without
 * actually invoking the SDK. Keeps the option-resolution logic testable.
 */
export function buildQueryOptions(
  op: OperatorContext,
  task: string,
  opts: RunOperatorOptions = {},
): Record<string, unknown> {
  const mcpPort = getConfig<number>("mcp.port") ?? 7891;
  const mcpUrl = opts.mcpServerUrl ?? `http://localhost:${mcpPort}/mcp`;
  const cwd = opts.cwd ?? op.worktreePath ?? process.cwd();
  const maxTurns = opts.maxTurns ?? 50;
  const maxBudgetUsd =
    getConfig<number | undefined>("operator.maxBudgetUsd") ??
    getConfig<number | undefined>("operator.maxBudgetUsd");

  const subagentDefs = opts.allOperators
    ? buildSubagentDefs(opts.allOperators.filter((o) => o.id !== op.id))
    : {};

  const taskBudget = resolveTaskBudget(opts);
  const effort = resolveEffort(op, opts);
  const agentProgressSummaries = getConfig<boolean>("operator.agentProgressSummaries") !== false;

  const options: Record<string, unknown> = {
    cwd,
    allowedTools: toolsForPreset(op.permissionPreset),
    agents: subagentDefs,
    mcpServers: {
      "claude-drive": { type: "http" as const, url: mcpUrl },
    },
    systemPrompt: buildOperatorSystemPrompt(op),
    maxTurns,
    agentProgressSummaries,
    ...(maxBudgetUsd ? { maxBudgetUsd } : {}),
    ...(taskBudget ? { taskBudget } : {}),
    ...(effort ? { effort } : {}),
  };
  // Silence unused-var when `task` is passed purely for future introspection.
  void task;
  return options;
}

/**
 * Run an operator to completion by consuming the SDK query stream.
 *
 * Returns a promise that resolves when the stream ends. For background operators
 * the caller typically does *not* await this promise — instead it is stored on
 * `op.runPromise` so consumers (e.g. `operator_await` MCP tool) can join later.
 */
export async function runOperator(
  op: OperatorContext,
  task: string,
  opts: RunOperatorOptions = {}
): Promise<void> {
  const run = async (): Promise<void> => {
    await ensureStartup();

    // Lazy import so the SDK is optional at module load time
    let queryFn: typeof import("@anthropic-ai/claude-agent-sdk").query;
    try {
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      queryFn = sdk.query;
    } catch {
      console.error("[OperatorManager] @anthropic-ai/claude-agent-sdk not installed. Run: npm install @anthropic-ai/claude-agent-sdk");
      return;
    }

    // Set up abort controller for task cancellation on dismiss
    const controller = new AbortController();
    op.abortController = controller;

    // Fire TaskStart hook
    const hookCtx = { event: "TaskStart" as const, operatorId: op.id, operatorName: op.name, timestamp: Date.now() };
    const hookResult = await hookRegistry.execute("TaskStart", hookCtx);
    if (hookResult.abort) {
      logActivity(op.name, `Task aborted by hook: ${task}`);
      return;
    }

    const isBackground = opts.isBackground === true;
    if (isBackground) {
      writeProgressEvent(op.id, { type: "task_started", description: task }, opts.progressBaseDir);
    }

    speak(`${op.name} starting: ${task}`);
    logActivity(op.name, `Starting task: ${task}`);

    const signal = opts.abortSignal ?? controller.signal;
    const queryOptions = buildQueryOptions(op, task, opts);

    // ts-expect: SDK options type is strict, buildQueryOptions is intentionally widened
    // to keep a test-friendly return value.
    const iterator = queryFn({
      prompt: task,
      options: {
        ...(queryOptions as Parameters<typeof queryFn>[0]["options"]),
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit|Write",
              hooks: [
                async (input: unknown) => {
                  const filePath = (input as { tool_input?: { file_path?: string } }).tool_input?.file_path;
                  if (filePath) logFile(op.name, filePath, "edited");
                  return {};
                },
              ],
            },
            {
              matcher: "Bash",
              hooks: [
                async (input: unknown) => {
                  const cmd = (input as { tool_input?: { command?: string } }).tool_input?.command;
                  if (cmd) logActivity(op.name, `$ ${cmd.slice(0, 120)}`);
                  return {};
                },
              ],
            },
          ],
        },
      },
    });

    for await (const msg of iterator) {
      // Check if task was cancelled (e.g., operator dismissed)
      if (signal?.aborted) {
        logActivity(op.name, "Task cancelled.");
        break;
      }

      const mAny = msg as { type?: string; subtype?: string };

      if (mAny.type === "system") {
        if (mAny.subtype === "init") {
          const sysMsg = msg as unknown as SDKSystemMessage & {
            session_id?: string;
            memory_paths?: string[];
          };
          if (sysMsg.session_id) op.sessionId = sysMsg.session_id;
          // memory_paths arrived in SDK 0.2.105; surface them in op.memory as a note.
          const mPaths = sysMsg.memory_paths;
          if (Array.isArray(mPaths) && mPaths.length > 0) {
            op.memory.push(`[sdk-memory-paths] ${mPaths.join(", ")}`);
          }
        } else if (mAny.subtype === "status") {
          const sMsg = msg as unknown as { status?: string | null };
          if (sMsg.status === "requesting") {
            logActivity(op.name, "⋯ waiting on the API");
          } else if (sMsg.status === "compacting") {
            logActivity(op.name, "↻ compacting context");
          }
        } else if (mAny.subtype === "task_started") {
          const t = msg as unknown as { description?: string; task_id?: string };
          logActivity(op.name, `▶ subtask start: ${t.description ?? t.task_id ?? ""}`);
          if (isBackground) {
            // NOTE: spread payload first, then stamp our marker last so the
            // progress-file `type` is always "task_started" (not SDK's "system").
            writeProgressEvent(op.id, { ...(t as object), type: "task_started" }, opts.progressBaseDir);
          }
        } else if (mAny.subtype === "task_progress" || mAny.subtype === "task_updated") {
          const t = msg as unknown as { description?: string; summary?: string; last_tool_name?: string; usage?: object };
          const line = t.summary ?? t.description ?? t.last_tool_name ?? "(progress)";
          agentOutput.emit("event", { type: "progress", agent: op.name, summary: line });
          logActivity(op.name, `» ${line}`);
          if (isBackground) {
            const kind = mAny.subtype === "task_updated" ? "task_updated" as const : "task_progress" as const;
            writeProgressEvent(op.id, { ...(t as object), type: kind }, opts.progressBaseDir);
          }
        } else if (mAny.subtype === "memory_recall") {
          const m = msg as unknown as {
            mode?: "select" | "synthesize";
            memories?: Array<{ path: string; scope?: string; content?: string }>;
          };
          if (getConfig<boolean>("memory.syncFromSdk") !== false) {
            try {
              importSdkMemoryEvent(op.id, m);
            } catch (e) {
              console.warn("[operatorManager] importSdkMemoryEvent failed:", e);
            }
          }
          const count = m.memories?.length ?? 0;
          logActivity(op.name, `🧠 memory_recall (${m.mode}, ${count} memor${count === 1 ? "y" : "ies"})`);
        }
      } else if (mAny.type === "rate_limit_event") {
        logActivity(op.name, "Rate limited — pausing");
        speak("Rate limited. Pausing.");
        const rle = msg as unknown as SDKRateLimitEvent;
        const info = rle.rate_limit_info;
        if (info) {
          console.warn(`[OperatorManager] rate limit status: ${info.status}, resetsAt: ${info.resetsAt}`);
        }
      } else if (mAny.type === "result") {
        const resultMsg = msg as unknown as SDKResultSuccess | SDKResultError;
        if (!resultMsg.is_error && "result" in resultMsg && resultMsg.result !== undefined) {
          logActivity(op.name, (resultMsg as SDKResultSuccess).result);
        }
        // Extract cost stats from result message (both success and error have these)
        const stats: TaskResultStats = {
          totalCostUsd: resultMsg.total_cost_usd ?? 0,
          durationMs: resultMsg.duration_ms ?? 0,
          apiDurationMs: resultMsg.duration_api_ms ?? 0,
          numTurns: resultMsg.num_turns ?? 0,
        };
        opts.onTaskComplete?.(op, stats);
        // Fire TaskComplete hook
        void hookRegistry.execute("TaskComplete", {
          event: "TaskComplete", operatorId: op.id, operatorName: op.name, timestamp: Date.now(),
        });
        speak(`${op.name} done.`);
        if (isBackground) {
          writeProgressEvent(
            op.id,
            { isError: resultMsg.is_error === true, stats, type: "result" },
            opts.progressBaseDir,
          );
        }
      }
    }

    // Best-effort context usage snapshot (requires streaming; may throw).
    try {
      const getUsage = (iterator as unknown as { getContextUsage?: () => Promise<{
        categories: Array<{ name: string; tokens: number }>;
        totalTokens: number; maxTokens: number; percentage: number;
      }> }).getContextUsage;
      if (typeof getUsage === "function" && opts.registry) {
        const usage = await getUsage.call(iterator);
        const byCategory: Record<string, number> = {};
        for (const c of usage.categories ?? []) byCategory[c.name] = c.tokens;
        const snapshot: ContextUsage = {
          total: usage.totalTokens,
          maxTokens: usage.maxTokens,
          percentage: usage.percentage,
          byCategory,
          updatedAt: Date.now(),
        };
        opts.registry.updateContextUsage(op.id, snapshot);
      }
    } catch {
      /* ignore — non-streaming mode or unsupported */
    }

    // Mark background operators as completed automatically so await can resolve.
    if (isBackground && opts.registry) {
      opts.registry.markStatus(op.id, "completed");
    }
  };

  try {
    const promise = run();
    if (opts.registry) opts.registry.setRunPromise(op.id, promise);
    await promise;
  } catch (err) {
    if (opts.isBackground) {
      writeProgressEvent(
        op.id,
        { type: "error", error: String(err instanceof Error ? err.message : err) },
        opts.progressBaseDir,
      );
      if (opts.registry) opts.registry.markStatus(op.id, "completed");
    }
    throw err;
  }
}
