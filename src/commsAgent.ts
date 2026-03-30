/**
 * commsAgent.ts — Operator status reporter.
 * Batches operator completion/progress/sync events and flushes
 * after N seconds of idle. Uses a cheap model to generate 1-2 sentence
 * summaries, falls back to raw event list if model unavailable.
 * Ported from cursor-drive for Node.js (replaced vscode.LanguageModelChat
 * with Anthropic SDK).
 */

import { getConfig } from "./config.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CommsEvent {
  type: "progress" | "completion" | "sync" | "error" | "info";
  operatorName: string;
  message: string;
  timestamp: number;
}

export type CommsFlushHandler = (summary: string) => void;

// ── CommsAgent ──────────────────────────────────────────────────────────────

const MAX_QUEUE = 100;

export class CommsAgent {
  private queue: CommsEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: CommsFlushHandler[] = [];
  private enabled: boolean;
  private idleMs: number;

  constructor() {
    this.enabled = getConfig<boolean>("commsAgent.enabled") ?? true;
    this.idleMs = (getConfig<number>("commsAgent.idleSeconds") ?? 30) * 1000;
  }

  /** Register a flush handler (e.g. TTS, terminal output, SSE push). */
  onFlush(handler: CommsFlushHandler): void {
    this.handlers.push(handler);
  }

  /** Queue an event. Resets the idle timer. */
  push(event: CommsEvent): void {
    if (!this.enabled) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift(); // drop oldest
    }
    this.queue.push(event);
    this.resetTimer();
  }

  /** Convenience: push a progress event. */
  progress(operatorName: string, message: string): void {
    this.push({ type: "progress", operatorName, message, timestamp: Date.now() });
  }

  /** Convenience: push a completion event. */
  completion(operatorName: string, message: string): void {
    this.push({ type: "completion", operatorName, message, timestamp: Date.now() });
  }

  /** Convenience: push an error event. */
  error(operatorName: string, message: string): void {
    this.push({ type: "error", operatorName, message, timestamp: Date.now() });
  }

  /** Force an immediate flush. */
  async flush(): Promise<string | null> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return null;

    const events = this.queue.splice(0);
    const summary = await this.summarize(events);

    for (const handler of this.handlers) {
      try { handler(summary); } catch { /* ignore handler errors */ }
    }

    return summary;
  }

  /** Get queued event count. */
  get pending(): number {
    return this.queue.length;
  }

  /** Stop the agent and clear timers. */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.queue = [];
    this.handlers = [];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private resetTimer(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, this.idleMs);
  }

  /**
   * Summarize events. Tries Anthropic API with cheap model first,
   * falls back to raw formatting if unavailable.
   */
  private async summarize(events: CommsEvent[]): Promise<string> {
    // First try AI summary
    try {
      const modelId = getConfig<string>("models.routing") ?? "claude-3-5-haiku-20241022";
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();

      const eventText = events
        .map((e) => `[${e.type}] ${e.operatorName}: ${e.message}`)
        .join("\n");

      const response = await client.messages.create({
        model: modelId,
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Summarize these operator events in 1-2 concise sentences for a developer:\n\n${eventText}`,
          },
        ],
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");

      if (text.trim()) return text.trim();
    } catch {
      // Model unavailable — fall through to raw format
    }

    // Fallback: raw event list
    return this.rawFormat(events);
  }

  private rawFormat(events: CommsEvent[]): string {
    if (events.length === 1) {
      const e = events[0];
      return `${e.operatorName} ${e.type}: ${e.message}`;
    }

    // Group by operator
    const byOp = new Map<string, CommsEvent[]>();
    for (const e of events) {
      const arr = byOp.get(e.operatorName) ?? [];
      arr.push(e);
      byOp.set(e.operatorName, arr);
    }

    const parts: string[] = [];
    for (const [name, opEvents] of byOp) {
      const completions = opEvents.filter((e) => e.type === "completion").length;
      const errors = opEvents.filter((e) => e.type === "error").length;
      const latest = opEvents[opEvents.length - 1];
      let part = `${name}: ${latest.message}`;
      if (completions > 0) part += ` (${completions} completed)`;
      if (errors > 0) part += ` (${errors} errors)`;
      parts.push(part);
    }

    return parts.join(" | ");
  }
}
