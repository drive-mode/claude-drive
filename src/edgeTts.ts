/**
 * Edge-TTS backend — free, cloud, high-quality neural TTS.
 * Adapted from cursor-drive: removed vscode dependency, uses node speaker/player.
 * Requires: npm install edge-tts-universal (optional dependency)
 */
import { getConfig } from "./config.js";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

let edgeTtsAvailable: boolean | undefined;

export function stopEdgeTts(): void {
  // Audio playback is via OS command; handled by stop() in tts.ts via say fallback.
}

export function isEdgeTtsAvailable(): boolean {
  if (edgeTtsAvailable !== undefined) return edgeTtsAvailable;
  try {
    require.resolve("edge-tts-universal");
    edgeTtsAvailable = true;
  } catch {
    edgeTtsAvailable = false;
  }
  return edgeTtsAvailable;
}

function spawnPlayAudio(filePath: string): void {
  try {
    if (process.platform === "win32") {
      spawn("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$p = New-Object System.Media.SoundPlayer; $p.SoundLocation = '${filePath.replace(/'/g, "''")}'; $p.PlaySync()`,
      ], { stdio: "ignore" });
    } else if (process.platform === "darwin") {
      spawn("afplay", [filePath], { stdio: "ignore" });
    } else {
      spawn("aplay", [filePath], { stdio: "ignore" });
    }
  } catch { /* ignore */ }
}

/** Speak text via Edge-TTS. Returns true if started. */
export async function speakEdgeTts(
  text: string,
  _volume: number,
  onSpoken?: (speech: string) => void
): Promise<boolean> {
  if (!isEdgeTtsAvailable()) return false;

  const voice = getConfig<string>("tts.edgeTtsVoice") ?? "en-US-EmmaMultilingualNeural";

  try {
    const { EdgeTTS } = await import("edge-tts-universal");
    const tts = new EdgeTTS(text, voice);
    const result = await tts.synthesize();
    const buffer = Buffer.from(await result.audio.arrayBuffer());

    // Write to temp file and play via OS command
    const tmpFile = path.join(os.tmpdir(), `claude-drive-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, buffer);
    spawnPlayAudio(tmpFile);
    // Clean up after a reasonable delay
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } }, 30_000);

    onSpoken?.(text);
    return true;
  } catch (e) {
    console.error("[Drive Edge-TTS]", e);
    return false;
  }
}
