/**
 * approvalQueue.ts — In-memory queue of pending approval requests.
 * Operators submit approval requests; the TUI or CLI resolves them.
 */
import { EventEmitter } from "events";
import { store } from "./store.js";

export interface ApprovalRequest {
  id: string;
  operatorName: string;
  command: string;
  severity: "warn" | "block";
  pattern: string;
  createdAt: number;
  resolve: (approved: boolean) => void;
}

export const approvalQueue = new EventEmitter();

const pending = new Map<string, ApprovalRequest>();

interface SerializedApprovalRequest {
  id: string;
  operatorName: string;
  command: string;
  severity: "warn" | "block";
  pattern: string;
  createdAt: number;
}

function persistQueue(): void {
  const items: SerializedApprovalRequest[] = [...pending.values()].map(
    ({ id, operatorName, command, severity, pattern, createdAt }) => ({
      id, operatorName, command, severity, pattern, createdAt,
    })
  );
  store.update("approvalQueue.pending", items);
}

export function restoreApprovalQueue(): void {
  const saved = store.get<SerializedApprovalRequest[] | undefined>("approvalQueue.pending", undefined);
  if (!saved || !Array.isArray(saved)) return;
  for (const item of saved) {
    if (pending.has(item.id)) continue;
    const request: ApprovalRequest = {
      ...item,
      resolve: () => {},  // stale — can't resolve across restarts
    };
    pending.set(item.id, request);
    approvalQueue.emit("request", request);
  }
}

export function requestApproval(
  operatorName: string,
  command: string,
  severity: "warn" | "block",
  pattern: string
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const request: ApprovalRequest = {
      id, operatorName, command, severity, pattern,
      createdAt: Date.now(),
      resolve,
    };
    pending.set(id, request);
    persistQueue();
    approvalQueue.emit("request", request);

    // Auto-deny blocks after 30s if no response
    if (severity === "block") {
      setTimeout(() => {
        if (pending.has(id)) {
          console.warn("[approval] auto-denied (timeout):", request);
          respondToApproval(id, false);
        }
      }, 30_000);
    }
  });
}

export function respondToApproval(id: string, approved: boolean): boolean {
  const request = pending.get(id);
  if (!request) return false;
  pending.delete(id);
  persistQueue();
  request.resolve(approved);
  approvalQueue.emit("response", { id, approved });
  return true;
}

export function listPendingApprovals(): ApprovalRequest[] {
  return [...pending.values()];
}
