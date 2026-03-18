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

let piperAvailable: boolean | undefined;
let currentProcess: import("child_process").ChildProcess | null = null;

export function stopPiper(): void {
  if (currentProcess) {
    try { currentProcess.kill("SIGTERM"); } catch { /* ignore */ }
    currentProcess = null;
  }
}

export function isPiperAvailable(): boolean {
  if (piperAvailable !== undefined) return piperAvailable;
  const exePath = (getConfig<string>("tts.piperBinaryPath") ?? "").trim();
  const modelPath = (getConfig<string>("tts.piperModelPath") ?? "").trim();
  if (!exePath || !modelPath) { piperAvailable = false; return false; }
  try {
    if (!fs.existsSync(exePath) || !fs.existsSync(modelPath)) { piperAvailable = false; return false; }
  } catch { piperAvailable = false; return false; }
  piperAvailable = true;
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
  currentProcess = proc;

  proc.stdin.write(text, "utf8", () => proc.stdin.end());

  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  proc.on("error", (err) => { console.error("[Drive Piper]", err); currentProcess = null; });
  proc.on("close", (code) => {
    currentProcess = null;
    if (code !== 0) { console.error("[Drive Piper] exit", code, stderr); return; }
    if (!fs.existsSync(wavPath)) return;
    const playProc = spawnPlayWav(wavPath);
    if (playProc) currentProcess = playProc;
    const done = () => {
      currentProcess = null;
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
