import { execFile, spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import type { BrowserSessionConfig } from "../sessionStore.js";
import { CHATGPT_URL } from "../browser/constants.js";
import { parseDuration } from "../duration.js";
import {
  acquireVoiceCommandLock,
  cancelBrowserVoiceInput,
  collectVoiceFeedback,
  finishBrowserVoiceInput,
  getVoiceFeedbackStatePath,
  getVoiceInputStatePath,
  isVoiceSessionUnavailableError,
  readVoiceInputState,
  startBrowserVoiceInput,
  VOICE_FEEDBACK_PROJECT_NAME,
  type VoiceInputState,
  type VoicePasteTarget,
} from "../browser/voiceInputRunner.js";
import { copyToClipboard } from "./clipboard.js";
import { getWhisperHomeDir } from "../whisperHome.js";
import { VoiceTrace, setActiveVoiceTrace } from "../voiceObservability.js";
import { loadWhisperConfig, resolveModelSetting } from "../whisperConfig.js";
import { getDictionaryPath, getPromptsDir, loadExtractorPrompt } from "../whisperPrompts.js";
import { hideRecordingIndicator, showRecordingIndicator } from "../recordingIndicator.js";

const execFileAsync = promisify(execFile);

const FEEDBACK_COLLECTOR_LOG = "/tmp/super-whisper-feedback.log";

export type VoiceInputCliAction = "start" | "finish" | "cancel" | "status" | "toggle";

export interface VoiceInputCliOptions {
  chatgptUrl?: string;
  profileDir?: string;
  inputTimeout?: string;
  force?: boolean;
  json?: boolean;
  verbose?: boolean;
  keepTab?: boolean;
  closeTab?: boolean;
  /** commander --no-clear => clear: false */
  clear?: boolean;
  /** commander --no-paste => paste: false */
  paste?: boolean;
  project?: string;
  replyTimeout?: string;
  /** Correction-feedback mode: dictate corrections for the user dictionary. */
  feedback?: boolean;
  /** One-off model override (otherwise ~/.super-whisper/config.json decides). */
  model?: string;
}

export async function runVoiceInputCliCommand(
  action: VoiceInputCliAction,
  options: VoiceInputCliOptions,
): Promise<void> {
  // Feedback sessions live in their own state file (and ChatGPT tab) so the
  // Ctrl+Shift+Z dictionary flow never collides with a normal Ctrl+Z session.
  const feedbackMode = Boolean(options.feedback);
  const statePath = feedbackMode ? getVoiceFeedbackStatePath() : getVoiceInputStatePath();

  if (action === "status") {
    await printVoiceInputStatus(Boolean(options.json), statePath);
    return;
  }

  const trace = new VoiceTrace(feedbackMode ? `${action}-feedback` : action, {
    project: options.project ?? null,
  });
  setActiveVoiceTrace(trace);
  const logger = trace.wrapLogger(((message: string) => {
    if (options.verbose || !message.startsWith("[debug]")) {
      console.log(chalk.dim(message));
    }
  }) as (message: string) => void);

  // Capture the frontmost app before any browser work (and before waiting on
  // the lock) so the finish step can paste the transcript back where the user
  // originally pressed the hotkey. Feedback mode never pastes anything.
  const pasteTarget =
    feedbackMode || options.paste === false || action === "finish" || action === "cancel"
      ? null
      : await captureFrontmostApp(logger);

  // Serialize start/finish/cancel/toggle across processes so rapid hotkey
  // presses cannot race the state file and start two recording sessions.
  // Hotkey presses must be DROPPED while another voice command is running,
  // not queued: a queued toggle would fire as "finish" the moment the start
  // completes, submitting the dictation before the user has spoken.
  let lock;
  if (action === "toggle") {
    try {
      lock = await acquireVoiceCommandLock({ logger, timeoutMs: 1_500 });
    } catch {
      logger("[voice] Another voice command is still running; ignoring this hotkey press.");
      trace.finish("dropped");
      return;
    }
  } else {
    lock = await acquireVoiceCommandLock({ logger });
  }
  try {
    const requestedToggle = action === "toggle";
    if (requestedToggle) {
      const state = await readVoiceInputState(statePath);
      action = state?.mode === "recording" ? "finish" : "start";
    }

    const runStart = async (force: boolean): Promise<void> => {
      const browserConfig = buildVoiceInputBrowserConfig(options);
      const result = await startBrowserVoiceInput({
        config: browserConfig,
        force,
        log: logger,
        statePath,
        pasteTarget,
        projectName: feedbackMode ? VOICE_FEEDBACK_PROJECT_NAME : (options.project ?? null),
        replyMode: feedbackMode ? false : Boolean(options.project),
        feedbackMode,
        projectInstructions: feedbackMode ? loadExtractorPrompt() : null,
      });
      trace.event("recording-started", {
        project: result.state.projectName,
        model: result.state.desiredModelLabel,
        chromePort: result.state.chromePort,
      });
      await showRecordingIndicator(
        feedbackMode ? "🎙 修正を受付中 (Ctrl+Shift+Z)" : "🎙 音声受付中 (Ctrl+Z)",
        logger,
      );
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(
        chalk.bold(feedbackMode ? "Dictation-correction feedback started" : "ChatGPT voice input started"),
      );
      console.log(`Speak now, then run: ${chalk.cyan("super-whisper voice finish")}`);
    };

    if (action === "start") {
      await runStart(Boolean(options.force));
      return;
    }

    if (action === "finish") {
      await hideRecordingIndicator();
      const timeoutMs = options.inputTimeout
        ? parseDuration(options.inputTimeout, 30_000)
        : undefined;
      let result;
      let pasted = false;
      // Paste inside onTranscript, which the runner calls BEFORE deleting the
      // throwaway conversation: getting the text in front of the user is the
      // whole product; the deletion is background housekeeping.
      const sessionState = await readVoiceInputState(statePath);
      const pasteTarget =
        !feedbackMode && options.paste !== false ? (sessionState?.pasteTarget ?? null) : null;
      try {
        result = await finishBrowserVoiceInput({
          log: logger,
          statePath,
          timeoutMs,
          replyTimeoutMs: options.replyTimeout
            ? parseDuration(options.replyTimeout, 240_000)
            : undefined,
          keepBrowser: options.closeTab ? false : true,
          keepTab: options.closeTab ? false : (options.keepTab ?? true),
          clearComposer: options.clear !== false,
          onTranscript: feedbackMode
            ? undefined
            : async (text) => {
                const copyResult = await copyToClipboard(text);
                if (!copyResult.success) {
                  const message =
                    copyResult.error instanceof Error
                      ? copyResult.error.message
                      : String(copyResult.error);
                  throw new Error(`Failed to copy voice transcription to clipboard: ${message}`);
                }
                if (pasteTarget) {
                  pasted = await pasteClipboardIntoApp(pasteTarget, logger);
                }
              },
        });
      } catch (error) {
        // Hotkey toggle: if the recorded session's browser/tab is gone,
        // recover by starting a fresh recording instead of erroring out.
        if (requestedToggle && isVoiceSessionUnavailableError(error)) {
          logger(`[voice] ${(error as Error).message}`);
          logger("[voice] Stored session is gone; starting a new voice input instead.");
          await runStart(true);
          return;
        }
        throw error;
      }
      trace.event("finish-complete", {
        transcriptChars: result.transcript.length,
        replyMode: Boolean(result.state.replyMode),
        feedbackMode: Boolean(result.state.feedbackMode),
        pasted,
        conversationUrl: result.conversationUrl ?? null,
      });
      if (feedbackMode) {
        if (result.conversationUrl) {
          spawnFeedbackCollector(result.state, result.conversationUrl, options, logger);
        } else {
          logger("[voice] No conversation URL after send; the dictionary was not updated.");
        }
        if (options.json) {
          console.log(JSON.stringify({ ...result, collector: Boolean(result.conversationUrl) }, null, 2));
          return;
        }
        console.log(chalk.bold("Feedback submitted"));
        console.log(
          `Dictionary update runs in the background (log: ${FEEDBACK_COLLECTOR_LOG}). You can keep dictating meanwhile.`,
        );
        return;
      }
      if (options.json) {
        console.log(JSON.stringify({ ...result, pasted }, null, 2));
        return;
      }
      const label = result.state.replyMode
        ? "ChatGPT reply"
        : "ChatGPT voice transcription";
      console.log(
        chalk.bold(
          pasted
            ? `Copied ${label} to clipboard and pasted it into the original app`
            : `Copied ${label} to clipboard`,
        ),
      );
      console.log(result.transcript);
      return;
    }

    await hideRecordingIndicator();
    const result = await cancelBrowserVoiceInput({
      log: logger,
      statePath,
      keepBrowser: options.closeTab ? false : true,
      keepTab: options.closeTab ? false : (options.keepTab ?? true),
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(chalk.bold("ChatGPT voice input cancelled"));
  } catch (error) {
    await hideRecordingIndicator();
    trace.recordError(error);
    trace.finish("error");
    throw error;
  } finally {
    // No-op when the error/dropped paths already closed the run.
    trace.finish("ok");
    await lock?.release().catch(() => undefined);
    setActiveVoiceTrace(null);
  }
}

/**
 * super-whisper simplification: the Oracle CLI resolved this through a large
 * flag/config pipeline (buildBrowserConfig + user config). Here the browser
 * config is built directly: manual-login profile only, no cookie sync, and the
 * lightest "Instant" model pinned in project mode.
 */
export function buildVoiceInputBrowserConfig(
  options: VoiceInputCliOptions,
): BrowserSessionConfig {
  const chatgptUrl = options.chatgptUrl ?? CHATGPT_URL;
  const projectMode = Boolean(options.project);
  const feedbackMode = Boolean(options.feedback);
  // Model per feature from ~/.super-whisper/config.json (defaults: dictation
  // "instant", dictionary "thinking" = the mid Medium tier); --model wins.
  const config = loadWhisperConfig();
  const desiredModel = options.model?.trim()
    ? resolveModelSetting(options.model)
    : feedbackMode
      ? resolveModelSetting(config.dictionaryModel)
      : projectMode
        ? resolveModelSetting(config.dictationModel)
        : null;
  return {
    url: chatgptUrl,
    chatgptUrl,
    // Any Chromium-based browser works (CDP); config.json "browserPath"
    // switches away from the default system Chrome.
    chromePath: config.browserPath,
    manualLogin: true,
    // Default to the product's own profile — without this the runner falls
    // back to oracle's ~/.oracle/browser-profile.
    manualLoginProfileDir:
      options.profileDir ??
      process.env.SUPER_WHISPER_BROWSER_PROFILE_DIR?.trim() ??
      path.join(getWhisperHomeDir(), "browser-profile"),
    cookieSync: false,
    inputTimeoutMs: options.inputTimeout
      ? parseDuration(options.inputTimeout, 60_000)
      : undefined,
    desiredModel,
    modelStrategy: desiredModel ? "select" : "ignore",
    researchMode: "off",
    archiveConversations: "never",
  };
}

/**
 * Fire-and-forget collector: a detached child waits for the extraction reply
 * and appends the pairs to the normalizer's dictionary, so the hotkey process
 * returns immediately and the user can keep dictating.
 */
function spawnFeedbackCollector(
  state: VoiceInputState,
  conversationUrl: string,
  options: VoiceInputCliOptions,
  logger: (message: string) => void,
): void {
  const binPath = process.argv[1];
  const packageRoot = path.resolve(path.dirname(binPath), "..");
  const logFd = openSync(FEEDBACK_COLLECTOR_LOG, "a");
  const args = [
    "--no-deprecation",
    "--import",
    "tsx",
    binPath,
    "feedback-collect",
    "--conversation-url",
    conversationUrl,
    "--chrome-host",
    state.chromeHost,
    "--chrome-port",
    String(state.chromePort),
    "--project",
    options.project ?? "Transcript Normalizer",
  ];
  if (options.verbose) {
    args.push("--verbose");
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: packageRoot,
  });
  child.unref();
  logger(`[voice] Dictionary collector started in the background (pid ${child.pid}).`);
}

export interface VoiceFeedbackCollectCliOptions {
  conversationUrl: string;
  chromeHost?: string;
  chromePort: string;
  project?: string;
  replyTimeout?: string;
  verbose?: boolean;
}

export async function runVoiceFeedbackCollectCommand(
  options: VoiceFeedbackCollectCliOptions,
): Promise<void> {
  const trace = new VoiceTrace("feedback-collect", {
    conversationUrl: options.conversationUrl,
    project: options.project ?? null,
  });
  setActiveVoiceTrace(trace);
  const logger = trace.wrapLogger((message: string) => {
    console.log(`${new Date().toISOString()} ${message}`);
  });
  try {
    const result = await collectVoiceFeedback({
      chromeHost: options.chromeHost,
      chromePort: Number(options.chromePort),
      conversationUrl: options.conversationUrl,
      normalizerProjectName: options.project ?? "Transcript Normalizer",
      replyTimeoutMs: options.replyTimeout ? parseDuration(options.replyTimeout, 240_000) : undefined,
      log: logger,
    });
    trace.finish("ok", { pairs: result.pairs.length, instructionsUpdated: result.instructionsUpdated });
    if (result.pairs.length > 0) {
      await notifyMac(
        `Dictionary updated (${result.pairs.length})`,
        result.pairs.join(", ").slice(0, 200),
      );
    } else {
      await notifyMac("No corrections extracted", "The feedback did not contain a usable pair.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger(`[voice] Feedback collection failed: ${message}`);
    trace.recordError(error);
    trace.finish("error");
    await notifyMac("Dictionary update failed", message.slice(0, 200));
    process.exitCode = 1;
  } finally {
    setActiveVoiceTrace(null);
  }
}

export interface VoiceSyncCliOptions {
  profileDir?: string;
  project?: string;
  verbose?: boolean;
}

/** `super-whisper sync`: push local prompt/dictionary files to the ChatGPT projects. */
export async function runVoiceSyncCommand(options: VoiceSyncCliOptions): Promise<void> {
  const trace = new VoiceTrace("sync");
  setActiveVoiceTrace(trace);
  const logger = trace.wrapLogger((message: string) => {
    if (options.verbose || !message.startsWith("[debug]")) {
      console.log(chalk.dim(message));
    }
  });
  const { syncVoiceProjectPrompts } = await import("../browser/voiceInputRunner.js");
  try {
    await syncVoiceProjectPrompts({
      config: buildVoiceInputBrowserConfig({
        profileDir: options.profileDir,
        project: options.project ?? "Transcript Normalizer",
      }),
      log: logger,
      normalizerProjectName: options.project ?? "Transcript Normalizer",
    });
    trace.finish("ok");
    console.log(chalk.bold("Prompts and dictionary synced to ChatGPT."));
    console.log(`Edit ${getPromptsDir()}/*.md and ${getDictionaryPath()}, then re-run: super-whisper sync`);
  } catch (error) {
    await hideRecordingIndicator();
    trace.recordError(error);
    trace.finish("error");
    throw error;
  } finally {
    setActiveVoiceTrace(null);
  }
}

async function notifyMac(title: string, body: string): Promise<void> {
  if (process.platform !== "darwin") return;
  // `display notification` needs no Accessibility/Automation grant.
  await execFileAsync(
    "osascript",
    ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`],
    { timeout: 5000 },
  ).catch(() => undefined);
}

async function printVoiceInputStatus(json: boolean, statePath: string): Promise<void> {
  const state = await readVoiceInputState(statePath);
  if (json) {
    console.log(JSON.stringify({ statePath, state }, null, 2));
    return;
  }
  if (!state) {
    console.log("No active ChatGPT voice input session.");
    return;
  }
  console.log(chalk.bold("Active ChatGPT voice input session"));
  console.log(`State: ${statePath}`);
  console.log(`Browser: ${state.chromeHost}:${state.chromePort}`);
  console.log(`Started: ${state.createdAt}`);
  console.log(`Finish: ${chalk.cyan("super-whisper voice finish")}`);
}

async function captureFrontmostApp(
  logger: (message: string) => void,
): Promise<VoicePasteTarget | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    // lsappinfo needs no Automation/Accessibility permission, unlike
    // System Events, so it also works from sandboxed or headless contexts.
    const { stdout: frontRaw } = await execFileAsync("lsappinfo", ["front"], { timeout: 5000 });
    const asn = frontRaw.trim();
    if (!asn) {
      return null;
    }
    const { stdout: infoRaw } = await execFileAsync(
      "lsappinfo",
      ["info", "-only", "bundleID", "-only", "name", asn],
      { timeout: 5000 },
    );
    const bundleId = infoRaw.match(/"CFBundleIdentifier"\s*=\s*"([^"]+)"/)?.[1];
    const appName = infoRaw.match(/"LSDisplayName"\s*=\s*"([^"]+)"/)?.[1];
    if (!bundleId && !appName) {
      return null;
    }
    logger(`[voice] Will paste the transcript back into ${appName ?? bundleId}.`);
    return { bundleId, appName };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger(`[voice] Could not detect the frontmost app (${message}); paste-back disabled.`);
    return null;
  }
}

async function pasteClipboardIntoApp(
  target: VoicePasteTarget,
  logger: (message: string) => void,
): Promise<boolean> {
  if (process.platform !== "darwin" || (!target.bundleId && !target.appName)) {
    return false;
  }
  try {
    // Activate via `open` (no Automation permission needed); only the Cmd+V
    // keystroke below requires Accessibility for the invoking process.
    if (target.bundleId) {
      await execFileAsync("open", ["-b", target.bundleId], { timeout: 10_000 });
    } else {
      await execFileAsync("open", ["-a", target.appName as string], { timeout: 10_000 });
    }
    await execFileAsync(
      "osascript",
      ["-e", "delay 0.25", "-e", 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 10_000 },
    );
    logger(`[voice] Pasted transcript into ${target.appName ?? target.bundleId}.`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger(
      `[voice] Could not paste into ${target.appName ?? target.bundleId} (${message}). ` +
        "If macOS blocked it, grant Accessibility permission to skhd/your terminal in System Settings > Privacy & Security > Accessibility. The transcript is still on the clipboard.",
    );
    return false;
  }
}
