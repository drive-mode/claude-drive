/**
 * operatorManager.ts — Agent SDK wrapper for claude-drive operators.
 * Maps each OperatorContext to a query() call with appropriate tool permissions.
 */
import type { OperatorContext, PermissionPreset } from "./operatorRegistry.js";
import type { SDKResultSuccess, SDKResultError, SDKSystemMessage, SDKRateLimitEvent, AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { logActivity, logFile, logDecision } from "./agentOutput.js";
import { speak } from "./tts.js";
import { getConfig } from "./config.js";
import { buildMemoryContext } from "./memoryManager.js";
import { hookRegistry } from "./hooks.js";
import { buildReflectionHooks, buildReflectorAgent, buildBestPracticesAgent } from "./reflectionGate.js";
import type { ReflectionHooks } from "./reflectionGate.js";

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
}

export async function runOperator(
  op: OperatorContext,
  task: string,
  opts: RunOperatorOptions = {}
): Promise<void> {
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

  const mcpPort = getConfig<number>("mcp.port") ?? 7891;
  const mcpUrl = opts.mcpServerUrl ?? `http://localhost:${mcpPort}/mcp`;
  const cwd = opts.cwd ?? op.worktreePath ?? process.cwd();
  const maxTurns = opts.maxTurns ?? 50;
  const maxBudgetUsd = getConfig<number>("operator.maxBudgetUsd");

  // Build operator subagent definitions (peer operators)
  const peerDefs = opts.allOperators
    ? buildSubagentDefs(opts.allOperators.filter((o) => o.id !== op.id))
    : {};

  const timeoutMs = getConfig<number>("operators.timeoutMs") ?? 300_000;
  const maxRetries = 3;
  const baseDelay = 1000;
  // Build reflection hooks and subagents (AutoResearch pattern)
  const reflectionEnabled = getConfig<boolean>("reflection.enabled") ?? true;
  const reflectionHooks: ReflectionHooks = reflectionEnabled
    ? buildReflectionHooks(op.role)
    : {};
  const reflectionAgents: Record<string, AgentDefinition> = reflectionEnabled
    ? { reflector: buildReflectorAgent(), "best-practices": buildBestPracticesAgent() }
    : {};

  const subagentDefs = { ...peerDefs, ...reflectionAgents };

  // Merge reflection hooks with built-in PostToolUse hooks
  const builtinPostToolUse = [
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
  ];

  const mergedHooks = {
    ...reflectionHooks,
    PostToolUse: [
      ...(reflectionHooks.PostToolUse ?? []),
      ...builtinPostToolUse,
    ],
  };

  // Fire TaskStart hook
  const hookCtx = { event: "TaskStart" as const, operatorId: op.id, operatorName: op.name, timestamp: Date.now() };
  const hookResult = await hookRegistry.execute("TaskStart", hookCtx);
  if (hookResult.abort) {
    logActivity(op.name, `Task aborted by hook: ${task}`);
    return;
  }

  speak(`${op.name} starting: ${task}`);
  logActivity(op.name, `Starting task: ${task}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for await (const msg of queryFn({
        prompt: task,
        options: {
          cwd,
          allowedTools: toolsForPreset(op.permissionPreset),
          agents: subagentDefs,
          mcpServers: {
            "claude-drive": { type: "http" as const, url: mcpUrl },
          },
          systemPrompt: buildOperatorSystemPrompt(op),
          maxTurns,
          ...(maxBudgetUsd ? { maxBudgetUsd } : {}),
          abortController: controller,
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
      })) {
        const mAny = msg as { type?: string };

        if (mAny.type === "system") {
          const sysMsg = msg as unknown as SDKSystemMessage;
          if (sysMsg.subtype === "init") {
            const sid = (sysMsg as SDKSystemMessage & { session_id?: string }).session_id;
            if (sid) op.sessionId = sid;
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
          const resultMsg = msg as unknown as SDKResultSuccess;
          if (!resultMsg.is_error && resultMsg.result !== undefined) {
            logActivity(op.name, resultMsg.result);
            speak(`${op.name} done.`);
          }
        }
  const signal = opts.abortSignal ?? controller.signal;

  for await (const msg of queryFn({
    prompt: task,
    options: {
      cwd,
      allowedTools: toolsForPreset(op.permissionPreset),
      agents: subagentDefs,
      mcpServers: {
        "claude-drive": { type: "http" as const, url: mcpUrl },
      },
      systemPrompt: buildOperatorSystemPrompt(op),
      maxTurns,
      ...(maxBudgetUsd ? { maxBudgetUsd } : {}),
      hooks: mergedHooks,
    },
  })) {
    // Check if task was cancelled (e.g., operator dismissed)
    if (signal?.aborted) {
      logActivity(op.name, "Task cancelled.");
      break;
    }

    const mAny = msg as { type?: string };

    if (mAny.type === "system") {
      const sysMsg = msg as unknown as SDKSystemMessage;
      if (sysMsg.subtype === "init") {
        const sid = (sysMsg as SDKSystemMessage & { session_id?: string }).session_id;
        if (sid) op.sessionId = sid;
      }
      // Success — break out of retry loop
      clearTimeout(timer);
      return;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isTimeout = isAbort || (err instanceof Error && err.message.includes("timeout"));
      if (isTimeout) {
        logActivity(op.name, `Timed out after ${timeoutMs}ms (attempt ${attempt}/${maxRetries})`);
      } else {
        logActivity(op.name, `Error (attempt ${attempt}/${maxRetries}): ${err}`);
      }
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(4, attempt - 1); // 1s, 4s, 16s
        logActivity(op.name, `Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        logActivity(op.name, `Failed after ${maxRetries} attempts`);
        op.status = "completed";
    } else if (mAny.type === "result") {
      const resultMsg = msg as unknown as (SDKResultSuccess | SDKResultError);
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
    }
  }
}
