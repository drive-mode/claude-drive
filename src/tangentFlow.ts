/**
 * tangentFlow.ts — Tangent agent introduction and confirmation flow.
 * When a tangent agent spawns, it introduces itself, summarizes tasks,
 * and waits for user confirmation before executing.
 * Ported from cursor-drive: replaced vscode.window modals → readline CLI + config.
 */

import readline from "readline";
import { speak } from "./tts.js";
import { getConfig } from "./config.js";
import type { OperatorContext } from "./operatorRegistry.js";

export type TangentConfirmResult =
  | { confirmed: true; task: string }
  | { confirmed: false; reason: "cancelled" | "edited_cancelled" };

let pendingResolve: ((value: "confirm") => void) | undefined;

/**
 * Resolve a pending tangent confirmation (e.g. from hotkey or MCP).
 * Returns true if there was a pending confirmation to resolve.
 */
export function resolvePendingTangentConfirm(): boolean {
  if (pendingResolve) {
    pendingResolve("confirm");
    pendingResolve = undefined;
    return true;
  }
  return false;
}

/**
 * Check if a tangent confirmation is currently pending.
 */
export function hasPendingTangentConfirm(): boolean {
  return !!pendingResolve;
}

/**
 * Read a line of input from stdin. Used for CLI confirmation flow.
 */
function promptUser(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Run the tangent agent confirmation flow: intro TTS, CLI prompt, optional timeout re-prompt.
 * For non-interactive MCP usage, auto-confirm via config option.
 * Returns confirmed + final task (may be edited), or cancelled.
 */
export async function confirmTangentAgent(
  op: OperatorContext,
  task: string,
  options: {
    timeoutMs?: number;
    onTimeoutReprompt?: () => void;
    updateTask?: (newTask: string) => void;
  } = {}
): Promise<TangentConfirmResult> {
  const autoConfirm = getConfig<boolean>("agents.tangentAutoConfirm") ?? true;
  const timeoutMs = options.timeoutMs ?? getConfig<number>("agents.tangentConfirmationTimeout") ?? 5000;

  const intro = `${op.name} here. So you'd like me to ${task}?`;
  speak(intro);

  // For non-interactive MCP server mode, auto-confirm by default
  if (autoConfirm) {
    return { confirmed: true, task };
  }

  const runConfirmation = (): Promise<"confirm" | "edit" | "cancel"> => {
    return new Promise<"confirm" | "edit" | "cancel">((resolve) => {
      console.log(`\nDrive: ${op.name} — ${task}`);
      console.log("Confirm to let the agent begin, or edit the task.");
      console.log("Options: [C]onfirm, [E]dit Tasks, [Ca]ncel");

      promptUser("> ").then((answer) => {
        const lower = answer.toLowerCase();
        if (lower === "c" || lower === "confirm") {
          resolve("confirm");
        } else if (lower === "e" || lower === "edit") {
          resolve("edit");
        } else {
          resolve("cancel");
        }
      });
    });
  };

  const runWithTimeout = (): Promise<"confirm" | "edit" | "cancel"> => {
    return new Promise<"confirm" | "edit" | "cancel">((resolve) => {
      let settled = false;
      const settle = (v: "confirm" | "edit" | "cancel") => {
        if (settled) return;
        settled = true;
        pendingResolve = undefined;
        resolve(v);
      };

      pendingResolve = () => settle("confirm");

      const timer = setTimeout(() => {
        if (settled) return;
        options.onTimeoutReprompt?.();
        speak("Before I begin, I need your confirmation. What are you thinking?");
      }, timeoutMs);

      void runConfirmation().then((v) => {
        clearTimeout(timer);
        settle(v);
      });
    });
  };

  let currentTask = task;
  for (;;) {
    const result = await runWithTimeout();
    if (result === "confirm") {
      return { confirmed: true, task: currentTask };
    }
    if (result === "cancel") {
      return { confirmed: false, reason: "cancelled" };
    }
    // Edit
    const edited = await promptUser("Edit the task for this tangent agent: ");
    if (!edited || !edited.trim()) {
      return { confirmed: false, reason: "edited_cancelled" };
    }
    currentTask = edited.trim();
    options.updateTask?.(currentTask);
  }
}
