import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWhisperHomeDir } from "./whisperHome.js";

/**
 * User configuration at ~/.super-whisper/config.json (created with defaults
 * on first use). Currently:
 *
 *   {
 *     "dictationModel": "instant",   // Ctrl+Z cleanup (Transcript Normalizer)
 *     "dictionaryModel": "thinking"  // Ctrl+Shift+Z extraction (Whisper Dictionary)
 *   }
 *
 * Accepted model values (case-insensitive): "instant", "thinking" (alias for
 * the mid "Medium" tier), "medium", "high", "extra high", "pro" /
 * "pro extended" — or any raw label, which is passed to the generic model
 * picker as-is.
 */

export interface WhisperConfig {
  dictationModel: string;
  dictionaryModel: string;
}

const DEFAULT_CONFIG: WhisperConfig = {
  dictationModel: "instant",
  dictionaryModel: "thinking",
};

export function getWhisperConfigPath(): string {
  return path.join(getWhisperHomeDir(), "config.json");
}

/** Loads the config, creating it with defaults on first use. Never throws. */
export function loadWhisperConfig(): WhisperConfig {
  const configPath = getWhisperConfigPath();
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<WhisperConfig>;
    return {
      dictationModel:
        typeof parsed.dictationModel === "string" && parsed.dictationModel.trim()
          ? parsed.dictationModel.trim()
          : DEFAULT_CONFIG.dictationModel,
      dictionaryModel:
        typeof parsed.dictionaryModel === "string" && parsed.dictionaryModel.trim()
          ? parsed.dictionaryModel.trim()
          : DEFAULT_CONFIG.dictionaryModel,
    };
  } catch {
    try {
      mkdirSync(getWhisperHomeDir(), { recursive: true });
      writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", { flag: "wx" });
    } catch {
      // exists or unwritable — either way, run with defaults
    }
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Maps a user-friendly config value to the effort-tier label the picker
 * understands. Unknown values pass through unchanged so power users can
 * target any label the generic model picker can find.
 */
export function resolveModelSetting(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, " ");
  switch (normalized) {
    case "instant":
    case "fast":
      return "Instant";
    case "thinking":
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "extra high":
    case "extrahigh":
      return "Extra High";
    case "pro":
    case "pro extended":
      return "Pro Extended";
    default:
      return value.trim();
  }
}
