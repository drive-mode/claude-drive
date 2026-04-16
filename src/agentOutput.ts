/**
 * agentOutput.ts — Terminal output renderer for claude-drive.
 * Replaces the VS Code webview AgentScreen. Emits colored terminal output
 * grouped by operator name. Optionally serves an SSE stream on :7892.
 */
import { EventEmitter } from "events";

// ── Event types (mirrors AgentScreen event structure) ──────────────────────

export interface ActivityEvent {
  type: "activity";
  agent: string;
  text: string;
  timestamp?: number;
}
export interface FileEvent {
  type: "file";
  agent: string;
  path: string;
  action?: string;
}
export interface DecisionEvent {
  type: "decision";
  agent: string;
  text: string;
}
export interface ChimeEvent { type: "chime"; name?: string; }
export interface ClearEvent { type: "clear"; }
export interface ProgressEvent {
  type: "progress";
  agent: string;
  summary: string;
  toolsUsed?: number;
}

export type DriveOutputEvent =
  | ActivityEvent
  | FileEvent
  | DecisionEvent
  | ChimeEvent
  | ClearEvent
  | ProgressEvent;

// ── ANSI color helpers ──────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const OPERATOR_COLORS = [
  "\x1b[36m",  // cyan
  "\x1b[35m",  // magenta
  "\x1b[33m",  // yellow
  "\x1b[32m",  // green
  "\x1b[34m",  // blue
  "\x1b[31m",  // red
];

const operatorColorMap = new Map<string, string>();
let colorIndex = 0;

function colorFor(agent: string): string {
  if (!operatorColorMap.has(agent)) {
    operatorColorMap.set(agent, OPERATOR_COLORS[colorIndex % OPERATOR_COLORS.length]);
    colorIndex++;
  }
  return operatorColorMap.get(agent)!;
}

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

// ── Output emitter ──────────────────────────────────────────────────────────

export class AgentOutputEmitter extends EventEmitter {
  private sseBroadcast: ((data: string) => void) | null = null;
  private renderMode: "terminal" | "tui" = "terminal";

  setSseBroadcast(fn: (data: string) => void): void {
    this.sseBroadcast = fn;
  }

  setRenderMode(mode: "terminal" | "tui"): void {
    this.renderMode = mode;
  }

  getRenderMode(): "terminal" | "tui" {
    return this.renderMode;
  }

  emit(eventName: string, event?: DriveOutputEvent): boolean {
    if (eventName !== "event" || !event) return super.emit(eventName, event);

    this.renderToTerminal(event);
    this.sseBroadcast?.(JSON.stringify(event));
    return super.emit("event", event);
  }

  private renderToTerminal(event: DriveOutputEvent): void {
    if (this.renderMode === "tui") return; // TUI owns stdout
    switch (event.type) {
      case "activity": {
        const color = colorFor(event.agent);
        process.stdout.write(
          `${DIM}${ts()}${RESET} ${color}${BOLD}[${event.agent}]${RESET} ${event.text}\n`
        );
        break;
      }
      case "file": {
        const color = colorFor(event.agent);
        const action = event.action ?? "touched";
        process.stdout.write(
          `${DIM}${ts()}${RESET} ${color}[${event.agent}]${RESET} ${DIM}${action}${RESET} ${event.path}\n`
        );
        break;
      }
      case "decision": {
        const color = colorFor(event.agent);
        process.stdout.write(
          `${DIM}${ts()}${RESET} ${color}[${event.agent}]${RESET} ${BOLD}Decision:${RESET} ${event.text}\n`
        );
        break;
      }
      case "progress": {
        const color = colorFor(event.agent);
        process.stdout.write(
          `${DIM}${ts()}${RESET} ${color}[${event.agent}]${RESET} ${DIM}»${RESET} ${event.summary}\n`,
        );
        break;
      }
      case "chime":
        // Terminal bell
        process.stdout.write("\x07");
        break;
      case "clear":
        process.stdout.write("\x1b[2J\x1b[H");
        break;
    }
  }
}

export const agentOutput = new AgentOutputEmitter();

/** Convenience: log an activity message. */
export function logActivity(agent: string, text: string): void {
  agentOutput.emit("event", { type: "activity", agent, text, timestamp: Date.now() });
}

/** Convenience: log a file touch. */
export function logFile(agent: string, filePath: string, action?: string): void {
  agentOutput.emit("event", { type: "file", agent, path: filePath, action });
}

/** Convenience: log a decision. */
export function logDecision(agent: string, text: string): void {
  agentOutput.emit("event", { type: "decision", agent, text });
}

/** Print Drive status line to stderr (non-blocking). */
export function printStatus(active: boolean, mode: string, operatorName?: string, backgroundCount = 0): void {
  const icon = active ? "●" : "○";
  const bg = backgroundCount > 0 ? ` (+${backgroundCount})` : "";
  const op = operatorName ? ` | ${operatorName}${bg}` : "";
  process.stderr.write(`\r${BOLD}[Drive]${RESET} ${icon} ${mode}${op}  \n`);
}
