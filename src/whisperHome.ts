import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * super-whisper keeps all of its state (voice session file, command lock,
 * project cache, default browser profile) under ~/.super-whisper so it never
 * collides with an Oracle CLI installation using ~/.oracle.
 */
export function getWhisperHomeDir(): string {
  const dir = process.env.SUPER_WHISPER_HOME_DIR ?? path.join(os.homedir(), ".super-whisper");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // best effort; callers mkdir again where it matters
  }
  return dir;
}
