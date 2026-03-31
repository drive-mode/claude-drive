/**
 * fsUtils.ts — Atomic file write utilities.
 * Prevents corruption from crashes mid-write by writing to .tmp then renaming.
 */

import * as fsAsync from "fs/promises";
import fs from "fs";

/**
 * Write JSON data atomically (async) — write to .tmp, then rename.
 * Rename is atomic on POSIX; on Windows it's close enough for our needs.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + ".tmp";
  await fsAsync.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fsAsync.rename(tmp, filePath);
}

/**
 * Write JSON data atomically (sync) — write to .tmp, then rename.
 * For modules that use synchronous fs operations.
 */
export function writeJsonAtomicSync(filePath: string, data: unknown): void {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}
