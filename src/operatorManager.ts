/**
 * operatorManager.ts — Agent SDK wrapper for claude-drive operators.
 * Maps each OperatorContext to a query() call with appropriate tool permissions.
 */
import type { OperatorContext, PermissionPreset } from "./operatorRegistry.js";
import { logActivity, logFile, logDecision } from "./agentOutput.js";
import { speak } from "./tts.js";
import { getConfig } from "./config.js";

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

  const mcpPort = getConfig<number>("mcp.port") ?? 7891;
  const mcpUrl = opts.mcpServerUrl ?? `http://localhost:${mcpPort}/mcp`;
  const cwd = opts.cwd ?? op.worktreePath ?? process.cwd();
  const maxTurns = opts.maxTurns ?? 50;

  const subagentDefs = opts.allOperators
    ? buildSubagentDefs(opts.allOperators.filter((o) => o.id !== op.id))
    : {};

  speak(`${op.name} starting: ${task}`);
  logActivity(op.name, `Starting task: ${task}`);

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
    if ("result" in msg) {
      logActivity(op.name, msg.result as string);
      speak(`${op.name} done.`);
    }
  }
}
