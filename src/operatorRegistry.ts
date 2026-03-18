/**
 * operatorRegistry.ts — Operator lifecycle manager for claude-drive.
 * Adapted from cursor-drive: replaced vscode.workspace.getConfiguration → getConfig().
 * All other logic is unchanged.
 */
import { EventEmitter } from "events";
import { getConfig } from "./config.js";
import type { SyncState } from "./syncTypes.js";

export type OperatorStatus = "active" | "background" | "completed" | "merged" | "paused";
export type OperatorRole = "implementer" | "reviewer" | "tester" | "researcher" | "planner";

export interface RoleTemplate {
  defaultPreset: PermissionPreset;
  description: string;
  systemHint: string;
}

export const ROLE_TEMPLATES: Record<OperatorRole, RoleTemplate> = {
  implementer: {
    defaultPreset: "standard",
    description: "Writes and modifies code",
    systemHint: "You are an implementer. Write production-quality code, follow existing patterns, and report files touched via agent_screen_file.",
  },
  reviewer: {
    defaultPreset: "readonly",
    description: "Reviews code without modifying files",
    systemHint: "You are a reviewer. Analyze code for bugs, risks, and quality. Do NOT edit files. Report findings via agent_screen_decision.",
  },
  tester: {
    defaultPreset: "standard",
    description: "Writes and runs tests",
    systemHint: "You are a tester. Write test cases, run test suites, and verify behavior. Report test results via agent_screen_activity.",
  },
  researcher: {
    defaultPreset: "readonly",
    description: "Researches solutions and gathers context",
    systemHint: "You are a researcher. Explore the codebase, read documentation, and synthesize findings. Do NOT edit production files.",
  },
  planner: {
    defaultPreset: "readonly",
    description: "Creates plans and breaks down tasks",
    systemHint: "You are a planner. Analyze requirements, break tasks into actionable steps, and produce plan artifacts. Do NOT implement code.",
  },
};

export interface EscalationEvent {
  operatorId: string;
  operatorName: string;
  reason: string;
  severity: "info" | "warning" | "critical";
  timestamp: number;
}

export type OperatorVisibility = "isolated" | "shared" | "collaborative";
export type PermissionPreset = "readonly" | "standard" | "full";

const PRESET_ORDER: PermissionPreset[] = ["readonly", "standard", "full"];

export function minPreset(a: PermissionPreset, b: PermissionPreset): PermissionPreset {
  return PRESET_ORDER.indexOf(a) <= PRESET_ORDER.indexOf(b) ? a : b;
}

export interface OperatorContext {
  id: string;
  name: string;
  voice: string | undefined;
  task: string;
  status: OperatorStatus;
  createdAt: number;
  memory: string[];
  visibility: OperatorVisibility;
  depth: number;
  parentId?: string;
  permissionPreset: PermissionPreset;
  role?: OperatorRole;
  systemHint?: string;
  worktreePath?: string;
  branchName?: string;
  baseCommit?: string;
  headCommit?: string;
  syncState?: SyncState;
}

export interface SpawnOptions {
  preset?: PermissionPreset;
  parentId?: string;
  depth?: number;
  role?: OperatorRole;
}

const FALLBACK_NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];

function getNamePool(): string[] {
  const pool = getConfig<string[]>("operators.namePool");
  return Array.isArray(pool) && pool.length > 0
    ? pool.filter((n) => typeof n === "string" && n.trim().length > 0).map((n) => String(n).trim())
    : FALLBACK_NAMES;
}

type RegistryListener = () => void;

export class OperatorRegistry {
  private operators: Map<string, OperatorContext> = new Map();
  private nameToId: Map<string, string> = new Map();
  private foregroundId: string | undefined;
  private listeners: Set<RegistryListener> = new Set();
  readonly events = new EventEmitter();

  onDidChange(listener: RegistryListener): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  spawn(name?: string, task = "", options?: SpawnOptions): OperatorContext {
    const id = `operator-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    let resolvedName = name?.trim() || this.nextAvailableName();
    if (this.nameToId.has(resolvedName.toLowerCase())) {
      resolvedName = this.nextAvailableNameFrom(resolvedName);
    }

    const requestedParentId = options?.parentId;
    const parentId = requestedParentId && this.operators.has(requestedParentId) ? requestedParentId : undefined;
    if (requestedParentId && !parentId) {
      console.warn(`[OperatorRegistry] spawn: parentId "${requestedParentId}" not found; spawning without parent.`);
    }

    const depth = options?.depth ?? (parentId ? (this.operators.get(parentId)!.depth) + 1 : 0);
    const role = options?.role;
    const roleTemplate = role ? ROLE_TEMPLATES[role] : undefined;

    let preset: PermissionPreset =
      options?.preset ?? roleTemplate?.defaultPreset ?? (depth > 0 ? "readonly" : "standard");

    if (parentId) {
      preset = minPreset(preset, this.operators.get(parentId)!.permissionPreset);
    }

    const op: OperatorContext = {
      id, name: resolvedName, voice: undefined, task, status: "active",
      createdAt: Date.now(), memory: [], visibility: "shared",
      depth, parentId, permissionPreset: preset, role, systemHint: roleTemplate?.systemHint,
    };
    this.operators.set(id, op);
    this.nameToId.set(resolvedName.toLowerCase(), id);

    if (!this.foregroundId) {
      this.foregroundId = id;
    } else {
      op.status = "background";
    }
    this.emitChange();
    return op;
  }

  private nextAvailableName(): string {
    for (const name of getNamePool()) {
      if (!this.nameToId.has(name.toLowerCase())) return name;
    }
    return `Operator${this.operators.size + 1}`;
  }

  private nextAvailableNameFrom(base: string): string {
    let candidate = base;
    let suffix = 2;
    while (this.nameToId.has(candidate.toLowerCase())) {
      candidate = `${base}${suffix}`;
      suffix++;
    }
    return candidate;
  }

  getForeground(): OperatorContext | undefined {
    if (!this.foregroundId) return undefined;
    return this.operators.get(this.foregroundId);
  }

  switchTo(nameOrId: string): OperatorContext | undefined {
    const target = this.findByNameOrId(nameOrId);
    if (!target) return undefined;
    const prevId = this.foregroundId;
    if (prevId && prevId !== target.id) {
      const prev = this.operators.get(prevId);
      if (prev && prev.status === "active") prev.status = "background";
    }
    this.foregroundId = target.id;
    target.status = "active";
    this.emitChange();
    return target;
  }

  pause(nameOrId: string): boolean {
    const op = this.findByNameOrId(nameOrId);
    if (!op) return false;
    op.status = "paused";
    if (this.foregroundId === op.id) this.foregroundId = this.pickNextForeground(op.id);
    this.emitChange();
    return true;
  }

  resume(nameOrId: string): boolean {
    const op = this.findByNameOrId(nameOrId);
    if (!op || op.status !== "paused") return false;
    op.status = this.foregroundId ? "background" : "active";
    if (!this.foregroundId) this.foregroundId = op.id;
    this.emitChange();
    return true;
  }

  dismiss(nameOrId: string): boolean {
    const op = this.findByNameOrId(nameOrId);
    if (!op) return false;
    op.status = "completed";
    this.events.emit("operatorCompleted", op.id, op.task || "completed");
    if (this.foregroundId === op.id) this.foregroundId = this.pickNextForeground(op.id);
    for (const child of this.operators.values()) {
      if (child.parentId === op.id && child.status !== "completed" && child.status !== "merged") {
        child.status = "completed";
        this.events.emit("operatorCompleted", child.id, `Cascade dismiss from ${op.name}`);
        if (this.foregroundId === child.id) this.foregroundId = this.pickNextForeground(child.id);
      }
    }
    this.emitChange();
    return true;
  }

  emitProgress(idOrName: string, message: string): void {
    const op = this.findByNameOrId(idOrName);
    if (op) this.events.emit("operatorProgress", op.id, message);
  }

  emitError(idOrName: string, error: string): void {
    const op = this.findByNameOrId(idOrName);
    if (op) this.events.emit("operatorError", op.id, error);
  }

  emitTaskDelegated(fromId: string, toId: string, task: string): void {
    this.events.emit("taskDelegated", fromId, toId, task);
  }

  merge(sourceName: string, targetName: string): boolean {
    const src = this.findByNameOrId(sourceName);
    const tgt = this.findByNameOrId(targetName);
    if (!src || !tgt) return false;
    tgt.memory.push(`[Merged from ${src.name}] Task: ${src.task}. Notes: ${src.memory.join("; ")}`);
    src.status = "merged";
    if (this.foregroundId === src.id) {
      this.foregroundId = tgt.id;
      tgt.status = "active";
    }
    this.emitChange();
    return true;
  }

  list(): OperatorContext[] { return [...this.operators.values()]; }

  getActive(): OperatorContext[] {
    return [...this.operators.values()].filter((o) => o.status !== "completed" && o.status !== "merged");
  }

  activeCount(): number { return this.getActive().length; }

  updateTask(idOrName: string, task: string): boolean {
    const op = this.findByNameOrId(idOrName);
    if (!op) return false;
    op.task = task;
    this.emitChange();
    return true;
  }

  updateMemory(idOrName: string, entry: string): void {
    const op = this.findByNameOrId(idOrName);
    if (!op) return;
    op.memory.push(entry);
    if (op.memory.length > 50) op.memory = op.memory.slice(-50);
    this.emitChange();
  }

  setVisibility(idOrName: string, visibility: OperatorVisibility): boolean {
    const op = this.findByNameOrId(idOrName);
    if (!op) return false;
    op.visibility = visibility;
    this.emitChange();
    return true;
  }

  delegate(fromIdOrName: string, toIdOrName: string, task: string): OperatorContext | undefined {
    const from = this.findByNameOrId(fromIdOrName);
    if (!from) return undefined;
    let to = this.findByNameOrId(toIdOrName);
    if (!to) {
      to = this.spawn(toIdOrName, task, { parentId: from.id, depth: from.depth + 1, preset: "readonly" });
    } else {
      to.task = task;
      this.emitChange();
    }
    this.emitTaskDelegated(from.id, to.id, task);
    return to;
  }

  effectivePreset(idOrName: string): PermissionPreset {
    const op = this.findByNameOrId(idOrName);
    if (!op) return "readonly";
    let preset = op.permissionPreset;
    let current = op;
    while (current.parentId) {
      const parent = this.operators.get(current.parentId);
      if (!parent) break;
      preset = minPreset(preset, parent.permissionPreset);
      current = parent;
    }
    return preset;
  }

  escalate(idOrName: string, reason: string, severity: EscalationEvent["severity"] = "warning"): boolean {
    const op = this.findByNameOrId(idOrName);
    if (!op) return false;
    const event: EscalationEvent = {
      operatorId: op.id, operatorName: op.name, reason, severity, timestamp: Date.now(),
    };
    this.events.emit("operatorEscalated", event);
    op.memory.push(`[Escalation/${severity}] ${reason}`);
    this.emitChange();
    return true;
  }

  updateWorkspaceState(idOrName: string, state: Partial<{
    worktreePath: string; branchName: string; baseCommit: string;
    headCommit: string; syncState: SyncState;
  }>): boolean {
    const op = this.findByNameOrId(idOrName);
    if (!op) return false;
    if (state.worktreePath !== undefined) op.worktreePath = state.worktreePath;
    if (state.branchName !== undefined) op.branchName = state.branchName;
    if (state.baseCommit !== undefined) op.baseCommit = state.baseCommit;
    if (state.headCommit !== undefined) op.headCommit = state.headCommit;
    if (state.syncState !== undefined) op.syncState = state.syncState;
    this.emitChange();
    return true;
  }

  static getRoleTemplate(role: OperatorRole): RoleTemplate { return ROLE_TEMPLATES[role]; }

  findByNameOrId(nameOrId: string): OperatorContext | undefined {
    const byId = this.operators.get(nameOrId);
    if (byId) return byId;
    const idByName = this.nameToId.get(nameOrId.toLowerCase());
    return idByName ? this.operators.get(idByName) : undefined;
  }

  private pickNextForeground(excludeId: string): string | undefined {
    for (const o of this.operators.values()) {
      if (o.id !== excludeId && (o.status === "active" || o.status === "background")) {
        o.status = "active";
        return o.id;
      }
    }
    return undefined;
  }
}
