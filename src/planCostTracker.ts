/**
 * planCostTracker.ts — Tracks costs per plan period.
 * A "plan period" starts when subMode changes to "plan" and ends when it
 * changes to something else (or a new plan begins). Costs accumulate for
 * all operator tasks that run during each plan period.
 */

export interface PlanCostEntry {
  planIndex: number;
  startedAt: number;
  endedAt: number | null;       // null = still active
  costUsd: number;
  durationMs: number;
  turns: number;
  taskCount: number;
}

export class PlanCostTracker {
  private plans: PlanCostEntry[] = [];
  private currentPlanIndex = 0;

  /** Call when the drive subMode changes. If entering "plan", start a new period. */
  onModeChange(newMode: string): void {
    if (newMode === "plan") {
      // Close any open plan period
      this.closeCurrentPlan();
      // Start a new plan period
      this.currentPlanIndex++;
      this.plans.push({
        planIndex: this.currentPlanIndex,
        startedAt: Date.now(),
        endedAt: null,
        costUsd: 0,
        durationMs: 0,
        turns: 0,
        taskCount: 0,
      });
    } else {
      // Leaving plan mode — close the current plan period
      this.closeCurrentPlan();
    }
  }

  /** Record cost from a completed task into the current plan period (if any). */
  recordCost(costUsd: number, durationMs: number, turns: number): void {
    const current = this.getCurrentPlan();
    if (!current) return;
    current.costUsd += costUsd;
    current.durationMs += durationMs;
    current.turns += turns;
    current.taskCount += 1;
  }

  /** Get the currently active plan period, or null. */
  getCurrentPlan(): PlanCostEntry | null {
    if (this.plans.length === 0) return null;
    const last = this.plans[this.plans.length - 1];
    return last.endedAt === null ? last : null;
  }

  /** Get all plan periods (for history). */
  getAllPlans(): PlanCostEntry[] {
    return [...this.plans];
  }

  /** Get the most recently completed plan (for display). */
  getLastCompletedPlan(): PlanCostEntry | null {
    for (let i = this.plans.length - 1; i >= 0; i--) {
      if (this.plans[i].endedAt !== null) return this.plans[i];
    }
    return null;
  }

  private closeCurrentPlan(): void {
    if (this.plans.length === 0) return;
    const last = this.plans[this.plans.length - 1];
    if (last.endedAt === null) {
      last.endedAt = Date.now();
    }
  }
}
