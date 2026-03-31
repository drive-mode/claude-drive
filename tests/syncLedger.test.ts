import { jest } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SyncLedger } from "../src/syncLedger.js";
import type { LedgerEntry } from "../src/syncLedger.js";

describe("SyncLedger", () => {
  let tmpDir: string;
  let ledger: SyncLedger;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "syncledger-test-"));
    ledger = new SyncLedger(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
      proposalId: "proposal-1",
      action: "approved",
      actor: "system",
      timestamp: Date.now(),
      ...overrides,
    };
  }

  describe("getAll()", () => {
    it("returns empty array when ledger file does not exist", async () => {
      const entries = await ledger.getAll();
      expect(entries).toEqual([]);
    });
  });

  describe("append()", () => {
    it("creates ledger file and appends a single entry", async () => {
      const entry = makeEntry({ proposalId: "p-1", action: "approved" });
      await ledger.append(entry);

      const entries = await ledger.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].proposalId).toBe("p-1");
      expect(entries[0].action).toBe("approved");
    });

    it("appends multiple entries in chronological order", async () => {
      await ledger.append(makeEntry({ proposalId: "p-1", timestamp: 1000 }));
      await ledger.append(makeEntry({ proposalId: "p-2", timestamp: 2000 }));
      await ledger.append(makeEntry({ proposalId: "p-3", timestamp: 3000 }));

      const entries = await ledger.getAll();
      expect(entries).toHaveLength(3);
      expect(entries[0].proposalId).toBe("p-1");
      expect(entries[1].proposalId).toBe("p-2");
      expect(entries[2].proposalId).toBe("p-3");
    });

    it("stores metadata when provided", async () => {
      const entry = makeEntry({ metadata: { error: "merge conflict" } });
      await ledger.append(entry);

      const entries = await ledger.getAll();
      expect(entries[0].metadata).toEqual({ error: "merge conflict" });
    });

    it("creates directory structure if it does not exist", async () => {
      const entry = makeEntry();
      await ledger.append(entry);

      const ledgerPath = path.join(tmpDir, ".drive", "state-sync", "ledger.json");
      const stat = await fs.stat(ledgerPath);
      expect(stat.isFile()).toBe(true);
    });
  });

  describe("getForProposal()", () => {
    it("filters entries by proposal ID", async () => {
      await ledger.append(makeEntry({ proposalId: "p-1", action: "approved" }));
      await ledger.append(makeEntry({ proposalId: "p-2", action: "rejected" }));
      await ledger.append(makeEntry({ proposalId: "p-1", action: "applied" }));

      const p1Entries = await ledger.getForProposal("p-1");
      expect(p1Entries).toHaveLength(2);
      expect(p1Entries[0].action).toBe("approved");
      expect(p1Entries[1].action).toBe("applied");
    });

    it("returns empty array for unknown proposal ID", async () => {
      await ledger.append(makeEntry({ proposalId: "p-1" }));
      const entries = await ledger.getForProposal("nonexistent");
      expect(entries).toEqual([]);
    });

    it("returns empty array on empty ledger", async () => {
      const entries = await ledger.getForProposal("anything");
      expect(entries).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("handles different action types", async () => {
      const actions: LedgerEntry["action"][] = ["approved", "rejected", "applied", "failed"];
      for (const action of actions) {
        await ledger.append(makeEntry({ proposalId: `p-${action}`, action }));
      }

      const entries = await ledger.getAll();
      expect(entries).toHaveLength(4);
      expect(entries.map((e) => e.action)).toEqual(actions);
    });
  });
});
