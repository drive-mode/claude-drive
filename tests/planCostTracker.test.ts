import { PlanCostTracker } from "../src/planCostTracker.js";

describe("PlanCostTracker", () => {
  let tracker: PlanCostTracker;

  beforeEach(() => {
    tracker = new PlanCostTracker();
  });

  it("has no current plan initially", () => {
    expect(tracker.getCurrentPlan()).toBeNull();
  });

  it("starts a plan period on mode change to plan", () => {
    tracker.onModeChange("plan");
    const plan = tracker.getCurrentPlan();
    expect(plan).not.toBeNull();
    expect(plan!.planIndex).toBe(1);
    expect(plan!.endedAt).toBeNull();
  });

  it("closes plan period on mode change away from plan", () => {
    tracker.onModeChange("plan");
    tracker.onModeChange("agent");
    expect(tracker.getCurrentPlan()).toBeNull();
    const last = tracker.getLastCompletedPlan();
    expect(last).not.toBeNull();
    expect(last!.endedAt).not.toBeNull();
  });

  it("records costs into active plan", () => {
    tracker.onModeChange("plan");
    tracker.recordCost(0.05, 5000, 3);
    tracker.recordCost(0.03, 3000, 2);
    const plan = tracker.getCurrentPlan();
    expect(plan!.costUsd).toBeCloseTo(0.08);
    expect(plan!.turns).toBe(5);
    expect(plan!.taskCount).toBe(2);
  });

  it("does not record costs when no plan is active", () => {
    tracker.recordCost(0.05, 5000, 3);
    expect(tracker.getAllPlans()).toHaveLength(0);
  });

  it("increments plan index on each new plan", () => {
    tracker.onModeChange("plan");
    tracker.onModeChange("agent");
    tracker.onModeChange("plan");
    const plan = tracker.getCurrentPlan();
    expect(plan!.planIndex).toBe(2);
  });

  it("closes previous plan when starting a new one", () => {
    tracker.onModeChange("plan");
    tracker.recordCost(0.01, 1000, 1);
    tracker.onModeChange("plan"); // new plan without going through agent first
    const plans = tracker.getAllPlans();
    expect(plans).toHaveLength(2);
    expect(plans[0].endedAt).not.toBeNull();
    expect(plans[1].endedAt).toBeNull();
  });

  it("getLastCompletedPlan returns the most recent completed plan", () => {
    tracker.onModeChange("plan");
    tracker.recordCost(0.01, 1000, 1);
    tracker.onModeChange("agent");
    tracker.onModeChange("plan");
    tracker.recordCost(0.02, 2000, 2);
    tracker.onModeChange("agent");
    const last = tracker.getLastCompletedPlan();
    expect(last!.planIndex).toBe(2);
    expect(last!.costUsd).toBeCloseTo(0.02);
  });
});
