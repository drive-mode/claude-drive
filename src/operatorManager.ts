/**
 * operatorManager.ts — Agent SDK wrapper for claude-drive operators.
 * Maps each OperatorContext to a query() call with appropriate tool permissions.
 */
import type { OperatorContext, PermissionPreset, OperatorCompletionResult } from "./operatorRegistry.js";
import type { OperatorRegistry } from "./operatorRegistry.js";
import type { SDKResultSuccess, SDKSystemMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import { logActivity, logFile, logDecision } from "./agentOutput.js";
import { speak } from "./tts.js";
import { getConfig } from "./config.js";
import type { CostTracker } from "./costTracker.js";
import { runVerification, formatVerificationErrors } from "./verifier.js";
import type { WorktreeManager } from "./worktreeManager.js";

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
  if (op.memory.length > 0) {
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

export interface RunOperatorOptions {
  cwd?: string;
  mcpServerUrl?: string;
  maxTurns?: number;
  allOperators?: OperatorContext[];
  registry?: OperatorRegistry;
  costTracker?: CostTracker;
  worktreeManager?: WorktreeManager;
}

export async function runOperator(
  op: OperatorContext,
  task: string,
  opts: RunOperatorOptions = {}
): Promise<OperatorCompletionResult> {
  const resolve = (result: OperatorCompletionResult): OperatorCompletionResult => {
    opts.registry?.resolveCompletion(op.id, result);
    return result;
  };

  // Lazy import so the SDK is optional at module load time
  let queryFn: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    queryFn = sdk.query;
  } catch {
    console.error("[OperatorManager] @anthropic-ai/claude-agent-sdk not installed. Run: npm install @anthropic-ai/claude-agent-sdk");
    return resolve({ success: false, error: "SDK not installed" });
  }

  const mcpPort = getConfig<number>("mcp.port") ?? 7891;
  const mcpUrl = opts.mcpServerUrl ?? `http://localhost:${mcpPort}/mcp`;
  const cwd = opts.cwd ?? op.worktreePath ?? process.cwd();
  const maxTurns = opts.maxTurns ?? 50;
  const maxBudgetUsd = getConfig<number>("operator.maxBudgetUsd");

  const subagentDefs = opts.allOperators
    ? buildSubagentDefs(opts.allOperators.filter((o) => o.id !== op.id))
    : {};

  const timeoutMs = getConfig<number>("operators.timeoutMs") ?? 300_000;
  const maxRetries = 3;
  const baseDelay = 1000;

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
          if (opts.costTracker && resultMsg.modelUsage) {
            opts.costTracker.recordFromResult(
              op.id,
              op.name,
              resultMsg.total_cost_usd ?? 0,
              resultMsg.modelUsage as Record<string, import("./costTracker.js").ModelUsageRecord>,
            );
          }
          if (!resultMsg.is_error && resultMsg.result !== undefined) {
            logActivity(op.name, resultMsg.result);
            speak(`${op.name} done.`);
          }
        }
      }
      // Success — break out of SDK retry loop
      clearTimeout(timer);

      // ── Verification gate ──────────────────────────────────────────────
      const verificationRequired = getConfig<boolean>("verification.required") ?? true;
      const verificationCommands = getConfig<string[]>("verification.commands") ?? [];

      if (verificationRequired && verificationCommands.length > 0) {
        const verifyMaxRetries = getConfig<number>("verification.maxRetries") ?? 2;
        const worktreePath = opts.worktreeManager?.getAllocation(op.id)?.worktreePath ?? op.worktreePath ?? cwd;

        for (let vAttempt = 0; vAttempt <= verifyMaxRetries; vAttempt++) {
          op.status = "verifying";
          logActivity(op.name, `Running verification (attempt ${vAttempt + 1}/${verifyMaxRetries + 1})...`);
          const vResult = await runVerification(worktreePath);

          if (vResult.passed) {
            logActivity(op.name, `Verification passed in ${vResult.duration}ms`);
            speak(`${op.name} verification passed.`);
            return resolve({ success: true });
          }

          // Verification failed
          const errorPrompt = formatVerificationErrors(vResult);
          logActivity(op.name, `Verification failed (${vResult.results.filter((r) => !r.passed).length} command(s))`);

          if (vAttempt >= verifyMaxRetries) {
            logActivity(op.name, `Verification failed after ${verifyMaxRetries + 1} attempts — giving up`);
            speak(`${op.name} verification failed.`);
            return resolve({ success: false, error: `Verification failed:\n${errorPrompt}` });
          }

          // Re-invoke the Agent SDK with the fix prompt
          logActivity(op.name, `Sending fix prompt to operator (retry ${vAttempt + 1}/${verifyMaxRetries})...`);
          const fixController = new AbortController();
          const fixTimer = setTimeout(() => fixController.abort(), timeoutMs);
          try {
            for await (const _msg of queryFn({
              prompt: errorPrompt,
              options: {
                cwd: worktreePath,
                allowedTools: toolsForPreset(op.permissionPreset),
                agents: subagentDefs,
                mcpServers: {
                  "claude-drive": { type: "http" as const, url: mcpUrl },
                },
                systemPrompt: buildOperatorSystemPrompt(op),
                maxTurns,
                ...(maxBudgetUsd ? { maxBudgetUsd } : {}),
                abortController: fixController,
                ...(op.sessionId ? { sessionId: op.sessionId } : {}),
              },
            })) {
              // Consume messages (logging handled by hooks in a full implementation)
            }
          } catch (fixErr) {
            logActivity(op.name, `Fix attempt failed: ${fixErr}`);
          } finally {
            clearTimeout(fixTimer);
          }
        }
      }

      return resolve({ success: true });
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
        const baseBackoff = baseDelay * Math.pow(4, attempt - 1); // 1s, 4s, 16s
        const delay = Math.round(baseBackoff * (0.75 + Math.random() * 0.5)); // ±25% jitter
        logActivity(op.name, `Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        logActivity(op.name, `Failed after ${maxRetries} attempts`);
        return resolve({ success: false, error: `Failed after ${maxRetries} attempts` });
      }
    }
  }
  // Should not reach here, but resolve as failure if somehow it does
  return resolve({ success: false, error: "Unexpected exit from retry loop" });
}
