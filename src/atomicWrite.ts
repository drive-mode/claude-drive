/**
 * atomicWrite.ts — Atomic JSON file write via tmp + rename.
 * Prevents corruption if the process crashes mid-write.
 */
import fs from "fs";
import path from "path";

/**
 * Write JSON data atomically: write to .tmp file, then rename over target.
 * rename() is atomic on POSIX and Windows NTFS.
 */
export function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}
