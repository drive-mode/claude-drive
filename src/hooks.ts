/**
 * hooks.ts — Hook registry and execution engine for claude-drive.
 * Supports lifecycle hooks with command, prompt, and intercept types.
 */
import { execSync } from "child_process";
import { getConfig } from "./config.js";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionStop"
  | "OperatorSpawn"
  | "OperatorDismiss"
  | "ModeChange"
  | "PreApproval"
  | "PostApproval"
  | "MemoryWrite"
  | "TaskStart"
  | "TaskComplete";

export type HookType = "command" | "prompt";

export interface HookDefinition {
  id: string;
  event: HookEvent;
  type: HookType;
  matcher?: string;              // regex pattern for tool name / mode / etc.
  priority?: number;             // lower = earlier, default 100
  enabled?: boolean;
  command?: string;              // for "command" type
  prompt?: string;               // for "prompt" type
}

export interface HookContext {
  event: HookEvent;
  operatorId?: string;
  operatorName?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  mode?: string;
  sessionId?: string;
  timestamp: number;
}

export interface HookResult {
  abort?: boolean;
  modifiedInput?: unknown;
  inject?: string;
}

function matchesPattern(pattern: string | undefined, value: string | undefined): boolean {
  if (!pattern) return true;
  if (!value) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return value.includes(pattern);
  }
}

function contextMatchValue(ctx: HookContext): string | undefined {
  if (ctx.event === "PreToolUse" || ctx.event === "PostToolUse") return ctx.toolName;
  if (ctx.event === "ModeChange") return ctx.mode;
  return ctx.operatorName;
}

export class HookRegistry {
  private hooks: Map<string, HookDefinition> = new Map();

  register(def: HookDefinition): void {
    if (def.enabled === undefined) def.enabled = true;
    if (def.priority === undefined) def.priority = 100;
    this.hooks.set(def.id, def);
  }

  unregister(id: string): boolean {
    return this.hooks.delete(id);
  }

  list(event?: HookEvent): HookDefinition[] {
    const all = [...this.hooks.values()].filter((h) => h.enabled !== false);
    if (event) return all.filter((h) => h.event === event);
    return all;
  }

  async execute(event: HookEvent, context: HookContext): Promise<HookResult> {
    const enabled = getConfig<boolean>("hooks.enabled");
    if (enabled === false) return {};

    const applicable = this.list(event)
      .filter((h) => matchesPattern(h.matcher, contextMatchValue(context)))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const combined: HookResult = {};

    for (const hook of applicable) {
      try {
        if (hook.type === "command" && hook.command) {
          const result = this.executeCommand(hook.command, context);
          if (result.abort) combined.abort = true;
        } else if (hook.type === "prompt" && hook.prompt) {
          combined.inject = (combined.inject ?? "") + "\n" + hook.prompt;
        }
      } catch (e) {
        console.error(`[hooks] Hook "${hook.id}" failed:`, e);
      }
    }

    return combined;
  }

  private executeCommand(command: string, context: HookContext): HookResult {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOOK_EVENT: context.event,
      HOOK_OPERATOR_NAME: context.operatorName ?? "",
      HOOK_OPERATOR_ID: context.operatorId ?? "",
      HOOK_TOOL_NAME: context.toolName ?? "",
      HOOK_MODE: context.mode ?? "",
      HOOK_TIMESTAMP: String(context.timestamp),
    };
    if (context.toolInput) {
      env.HOOK_TOOL_INPUT = typeof context.toolInput === "string"
        ? context.toolInput
        : JSON.stringify(context.toolInput);
    }

    try {
      execSync(command, {
        env,
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return {};
    } catch (e: unknown) {
      const err = e as { status?: number };
      // Exit code 2 = abort the operation (convention from Claude Code hooks)
      if (err.status === 2) return { abort: true };
      return {};
    }
  }

  /** Load hook definitions from config. */
  loadFromConfig(): void {
    const defs = getConfig<HookDefinition[]>("hooks.definitions");
    if (Array.isArray(defs)) {
      for (const def of defs) {
        if (def.id && def.event && def.type) {
          this.register(def);
        }
      }
    }
  }

  /** Load hook definitions from JSON files in a directory. */
  loadFromDirectory(dir: string): void {
    try {
      const fs = require("fs") as typeof import("fs");
      const path = require("path") as typeof import("path");
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          const def = JSON.parse(content) as HookDefinition;
          if (def.id && def.event && def.type) {
            this.register(def);
          }
        } catch (e) {
          console.error(`[hooks] Failed to load hook file ${file}:`, e);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }
}

/** Singleton hook registry instance. */
export const hookRegistry = new HookRegistry();
