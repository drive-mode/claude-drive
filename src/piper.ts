/**
 * Piper TTS backend — free, local, neural TTS.
 * Adapted from cursor-drive: removed vscode dependency, uses getConfig().
 *
 * Setup:
 * 1. Download piper from https://github.com/rhasspy/piper/releases
 * 2. Download a voice from https://huggingface.co/rhasspy/piper-voices
 * 3. Set tts.piperBinaryPath and tts.piperModelPath in ~/.claude-drive/config.json
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { getConfig } from "./config.js";
import { logger } from "./logger.js";

/**
 * Runtime state for the piper backend: cached availability probe and the
 * currently-running synthesiser process. Encapsulated in a singleton so tests
 * can `__resetForTests()` without reloading the module.
 */
class PiperRuntime {
  available: boolean | undefined;
  current: import("child_process").ChildProcess | null = null;
  __resetForTests(): void {
    this.available = undefined;
    this.current = null;
  }
}
const piper = new PiperRuntime();

/** Test-only: reset cached availability + kill tracker. */
export function __resetPiperForTests(): void {
  piper.__resetForTests();
}

export function stopPiper(): void {
  if (piper.current) {
    try { piper.current.kill("SIGTERM"); } catch { /* ignore */ }
    piper.current = null;
  }
}

export function isPiperAvailable(): boolean {
  if (piper.available !== undefined) return piper.available;
  const exePath = (getConfig<string>("tts.piperBinaryPath") ?? "").trim();
  const modelPath = (getConfig<string>("tts.piperModelPath") ?? "").trim();
  if (!exePath || !modelPath) { piper.available = false; return false; }
  try {
    if (!fs.existsSync(exePath) || !fs.existsSync(modelPath)) { piper.available = false; return false; }
  } catch { piper.available = false; return false; }
  piper.available = true;
  return true;
}

export function speakPiper(text: string, _volume: number, onSpoken?: (speech: string) => void): boolean {
  if (!isPiperAvailable()) return false;
  stopPiper();

  const exePath = (getConfig<string>("tts.piperBinaryPath") ?? "").trim();
  const modelPath = (getConfig<string>("tts.piperModelPath") ?? "").trim();
  const speed = Math.max(0.5, Math.min(2, getConfig<number>("tts.speed") ?? 1));

  const wavPath = path.join(os.tmpdir(), `claude-drive-piper-${Date.now()}.wav`);
  const args = ["--model", modelPath, "--output_file", wavPath, "--length_scale", String(1 / speed)];
  const proc = spawn(exePath, args, { stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
  piper.current = proc;

  proc.stdin.write(text, "utf8", () => proc.stdin.end());

  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  proc.on("error", (err) => { logger.error("[Drive Piper]", err); piper.current = null; });
  proc.on("close", (code) => {
    piper.current = null;
    if (code !== 0) { logger.error("[Drive Piper] exit", code, stderr); return; }
    if (!fs.existsSync(wavPath)) return;
    const playProc = spawnPlayWav(wavPath);
    if (playProc) piper.current = playProc;
    const done = () => {
      piper.current = null;
      try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
      onSpoken?.(text);
    };
    if (playProc) { playProc.on("close", done); playProc.on("error", () => done()); }
    else done();
  });
  return true;
}

function spawnPlayWav(wavPath: string): import("child_process").ChildProcess | null {
  try {
    if (process.platform === "win32") {
      return spawn("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$p = New-Object System.Media.SoundPlayer; $p.SoundLocation = '${wavPath.replace(/'/g, "''")}'; $p.PlaySync()`,
      ], { stdio: "ignore" });
    }
    if (process.platform === "darwin") return spawn("afplay", [wavPath], { stdio: "ignore" });
    return spawn("aplay", [wavPath], { stdio: "ignore" });
  } catch { return null; }
}
