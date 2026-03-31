import { jest } from "@jest/globals";
import {
  requestApproval,
  respondToApproval,
  listPendingApprovals,
  approvalQueue,
} from "../src/approvalQueue.js";

describe("approvalQueue", () => {
  afterEach(() => {
    // Resolve any lingering pending requests to prevent open handles
    for (const req of listPendingApprovals()) {
      respondToApproval(req.id, false);
    }
    approvalQueue.removeAllListeners();
  });

  describe("requestApproval()", () => {
    it("enqueues a request that appears in pending list", () => {
      // Don't await — the promise only resolves when someone responds
      const promise = requestApproval("Alpha", "rm -rf /", "warn", "rm.*");
      const pending = listPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0].operatorName).toBe("Alpha");
      expect(pending[0].command).toBe("rm -rf /");
      expect(pending[0].severity).toBe("warn");
      expect(pending[0].pattern).toBe("rm.*");

      // Clean up
      respondToApproval(pending[0].id, false);
      return promise; // let jest see the resolved promise
    });

    it("emits 'request' event on enqueue", () => {
      const listener = jest.fn();
      approvalQueue.on("request", listener);

      const promise = requestApproval("Beta", "drop table", "block", "drop.*");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ operatorName: "Beta", command: "drop table" })
      );

      // Clean up
      const pending = listPendingApprovals();
      respondToApproval(pending[0].id, false);
      return promise;
    });

    it("supports multiple concurrent requests", () => {
      const p1 = requestApproval("Op1", "cmd1", "warn", "p1");
      const p2 = requestApproval("Op2", "cmd2", "warn", "p2");

      const pending = listPendingApprovals();
      expect(pending.length).toBe(2);

      // Clean up
      respondToApproval(pending[0].id, false);
      respondToApproval(pending[1].id, false);
      return Promise.all([p1, p2]);
    });
  });

  describe("respondToApproval()", () => {
    it("approving resolves the promise with true and removes from pending", async () => {
      const promise = requestApproval("Alpha", "cmd", "warn", ".*");
      const pending = listPendingApprovals();
      const id = pending[0].id;

      const result = respondToApproval(id, true);
      expect(result).toBe(true);
      expect(listPendingApprovals().length).toBe(0);

      const approved = await promise;
      expect(approved).toBe(true);
    });

    it("denying resolves the promise with false and removes from pending", async () => {
      const promise = requestApproval("Alpha", "cmd", "warn", ".*");
      const pending = listPendingApprovals();
      const id = pending[0].id;

      const result = respondToApproval(id, false);
      expect(result).toBe(true);
      expect(listPendingApprovals().length).toBe(0);

      const approved = await promise;
      expect(approved).toBe(false);
    });

    it("emits 'response' event on respond", () => {
      const listener = jest.fn();
      approvalQueue.on("response", listener);

      const promise = requestApproval("Alpha", "cmd", "warn", ".*");
      const id = listPendingApprovals()[0].id;
      respondToApproval(id, true);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ id, approved: true });

      return promise;
    });

    it("returns false for non-existent request ID", () => {
      const result = respondToApproval("does-not-exist", true);
      expect(result).toBe(false);
    });

    it("returns false when responding to same ID twice", async () => {
      const promise = requestApproval("Alpha", "cmd", "warn", ".*");
      const id = listPendingApprovals()[0].id;

      expect(respondToApproval(id, true)).toBe(true);
      expect(respondToApproval(id, true)).toBe(false);

      await promise;
    });
  });

  describe("auto-deny timeout", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("auto-denies 'block' severity after 30s", async () => {
      const promise = requestApproval("Alpha", "dangerous", "block", ".*");
      expect(listPendingApprovals().length).toBe(1);

      jest.advanceTimersByTime(30_000);

      const approved = await promise;
      expect(approved).toBe(false);
      expect(listPendingApprovals().length).toBe(0);
    });

    it("does not auto-deny 'warn' severity", () => {
      const promise = requestApproval("Alpha", "safe-ish", "warn", ".*");
      expect(listPendingApprovals().length).toBe(1);

      jest.advanceTimersByTime(60_000);

      // Still pending because warn does not auto-deny
      expect(listPendingApprovals().length).toBe(1);

      // Clean up
      const id = listPendingApprovals()[0].id;
      respondToApproval(id, false);
      return promise;
    });

    it("does not auto-deny if resolved before timeout", async () => {
      const promise = requestApproval("Alpha", "dangerous", "block", ".*");
      const id = listPendingApprovals()[0].id;

      // Respond before timeout fires
      respondToApproval(id, true);
      jest.advanceTimersByTime(30_000);

      const approved = await promise;
      expect(approved).toBe(true);
    });
  });

  describe("listPendingApprovals()", () => {
    it("returns empty array when no requests pending", () => {
      expect(listPendingApprovals()).toEqual([]);
    });

    it("returns a copy, not the internal map", () => {
      const promise = requestApproval("Alpha", "cmd", "warn", ".*");
      const list1 = listPendingApprovals();
      const list2 = listPendingApprovals();
      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);

      // Clean up
      respondToApproval(list1[0].id, false);
      return promise;
    });
  });
});
