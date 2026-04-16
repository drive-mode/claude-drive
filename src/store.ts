/**
 * store.ts — Simple JSON file-based key-value store.
 * Replaces vscode.Memento for state persistence outside VS Code.
 *
 * Implementation: each caller gets a singleton instance of `StateStore`.
 * The default instance (exported as `store`) persists under
 * `${home()}/state.json`. Alternative base paths — primarily useful in
 * tests — can be constructed via `createStore(path)`.
 */
import fs from "fs";
import path from "path";
import { atomicWriteJSON } from "./atomicWrite.js";
import { home } from "./paths.js";
import { logger } from "./logger.js";

class StateStore {
  private cache: Record<string, unknown> = {};
  private loaded = false;

  constructor(private filePath: string) {}

  private ensureLoaded(): void {
    if (this.loaded) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      this.cache = {};
    }
    this.loaded = true;
  }

  private flush(): void {
    try {
      atomicWriteJSON(this.filePath, this.cache);
    } catch (e) {
      logger.error("[store] Failed to flush:", e);
    }
  }

  get<T>(key: string, defaultValue: T): T {
    this.ensureLoaded();
    return key in this.cache ? (this.cache[key] as T) : defaultValue;
  }

  update(key: string, value: unknown): void {
    this.ensureLoaded();
    this.cache[key] = value;
    this.flush();
  }

  keys(): readonly string[] {
    this.ensureLoaded();
    return Object.keys(this.cache);
  }

  /** Test-only: drop cached state so the next read reloads from disk. */
  __resetForTests(): void {
    this.cache = {};
    this.loaded = false;
  }
}

/** Construct a store rooted at an arbitrary file path. */
export function createStore(filePath: string): StateStore {
  return new StateStore(filePath);
}

/** Default singleton — persists under `${home()}/state.json`. */
export const store: StateStore = new StateStore(path.join(home(), "state.json"));
