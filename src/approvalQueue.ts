/**
 * approvalQueue.ts — In-memory queue of pending approval requests.
 * Operators submit approval requests; the TUI or CLI resolves them.
 */
import { EventEmitter } from "events";

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
    approvalQueue.emit("request", request);

    // Auto-deny blocks after 30s if no response
    if (severity === "block") {
      setTimeout(() => {
        if (pending.has(id)) {
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
  request.resolve(approved);
  approvalQueue.emit("response", { id, approved });
  return true;
}

export function listPendingApprovals(): ApprovalRequest[] {
  return [...pending.values()];
}
