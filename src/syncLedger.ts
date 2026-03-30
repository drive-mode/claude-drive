/**
 * syncLedger.ts — Append-only JSON ledger for sync decisions.
 * Stores at .drive/state-sync/ledger.json with immutable history.
 */

import * as fs from "fs/promises";
import * as path from "path";

export interface LedgerEntry {
  proposalId: string;
  action: "approved" | "rejected" | "applied" | "failed";
  actor: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const STATE_SYNC_DIR = ".drive/state-sync";

export class SyncLedger {
  private ledgerPath: string;

  constructor(workspaceRoot: string) {
    this.ledgerPath = path.join(workspaceRoot, STATE_SYNC_DIR, "ledger.json");
  }

  /**
   * Append a single entry to the ledger.
   * Creates the directory structure if it doesn't exist.
   */
  async append(entry: LedgerEntry): Promise<void> {
    const dir = path.dirname(this.ledgerPath);
    await fs.mkdir(dir, { recursive: true });

    const entries = await this.getAll();
    entries.push(entry);

    try {
      await fs.writeFile(this.ledgerPath, JSON.stringify(entries, null, 2), "utf-8");
    } catch (error) {
      console.error("[SyncLedger] Failed to append entry:", error);
      throw error;
    }
  }

  /**
   * Read all ledger entries in chronological order.
   * Returns empty array if ledger doesn't exist.
   */
  async getAll(): Promise<LedgerEntry[]> {
    try {
      const content = await fs.readFile(this.ledgerPath, "utf-8");
      return JSON.parse(content) as LedgerEntry[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      console.error("[SyncLedger] Failed to read ledger:", error);
      throw error;
    }
  }

  /**
   * Get all ledger entries for a specific proposal.
   */
  async getForProposal(proposalId: string): Promise<LedgerEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.proposalId === proposalId);
  }
}
