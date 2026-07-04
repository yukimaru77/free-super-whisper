#!/usr/bin/env tsx
import { Command } from "commander";

const program = new Command();

program
  .name("super-whisper")
  .description(
    "ChatGPT web-dictation driver: toggle voice input via a persistent signed-in Chrome profile, " +
      "normalize the transcript in a ChatGPT project, and paste the result back.",
  );

const VOICE_ACTIONS = ["start", "finish", "done", "cancel", "status", "toggle"] as const;

function addVoiceInputOptions(command: Command): Command {
  return command
    .option(
      "--project <name>",
      "Dictate inside this ChatGPT project, send the transcript, and copy the cleaned reply.",
      "Transcript Normalizer",
    )
    .option(
      "--raw",
      "Raw transcript mode: no project, no send/reply; copy the dictation as-is.",
      false,
    )
    .option(
      "--feedback",
      'Correction-feedback mode: dictate corrections ("X should be Y"); they are extracted in the background and appended to the normalizer\'s user dictionary.',
      false,
    )
    .option(
      "--no-paste",
      "Do not auto-paste the result into the app that was focused on start (macOS).",
    )
    .option("--no-clear", "Do not clear the transcribed text from the ChatGPT message field.")
    .option("--reply-timeout <duration>", "Timeout waiting for the ChatGPT reply (project mode).")
    .option(
      "--model <tier>",
      "One-off model override: instant | thinking | medium | high | extra-high | pro (default from ~/.super-whisper/config.json).",
    )
    .option("--chatgpt-url <url>", "ChatGPT URL to open (default https://chatgpt.com/).")
    .option("--profile-dir <path>", "Persistent Chrome profile directory override.")
    .option("--force", "Replace a stale active voice session on start.", false)
    .option("--json", "Print structured JSON.", false)
    .option("-v, --verbose", "Enable verbose browser logging.", false);
}

async function runVoiceAction(action: string | undefined, options: Record<string, unknown>) {
  const normalized = (action ?? "toggle").trim().toLowerCase();
  if (!(VOICE_ACTIONS as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unknown voice action: ${action}. Expected start, finish, cancel, status, or toggle.`,
    );
  }
  const { runVoiceInputCliCommand } = await import("../src/cli/voiceInput.js");
  const resolved = { ...options };
  if (resolved.raw) {
    // Raw transcript mode: no project, no send/reply round-trip.
    delete resolved.project;
  }
  await runVoiceInputCliCommand(
    normalized === "done"
      ? "finish"
      : (normalized as "start" | "finish" | "cancel" | "status" | "toggle"),
    resolved,
  );
}

const voiceCommand = program
  .command("voice [action]", { isDefault: true })
  .description(
    "Toggle ChatGPT browser voice input (actions: start, finish, cancel, status, toggle; default toggle).",
  );
addVoiceInputOptions(voiceCommand).action(async function (
  this: Command,
  action: string | undefined,
) {
  await runVoiceAction(action, this.opts());
});

// Internal: detached background half of `voice --feedback` (spawned by the
// finish step). Waits for the extraction reply, appends the pairs to the
// normalizer project's instructions, deletes the throwaway conversation.
program
  .command("feedback-collect", { hidden: true })
  .requiredOption("--conversation-url <url>", "Feedback conversation to process.")
  .requiredOption("--chrome-port <port>", "DevTools port of the running Chrome.")
  .option("--chrome-host <host>", "DevTools host.", "127.0.0.1")
  .option("--project <name>", "Normalizer project holding the dictionary.", "Transcript Normalizer")
  .option("--reply-timeout <duration>", "Timeout waiting for the extraction reply.")
  .option("-v, --verbose", "Enable verbose browser logging.", false)
  .action(async function (this: Command) {
    const { runVoiceFeedbackCollectCommand } = await import("../src/cli/voiceInput.js");
    await runVoiceFeedbackCollectCommand(
      this.opts() as Parameters<typeof runVoiceFeedbackCollectCommand>[0],
    );
  });

program
  .command("sync")
  .description(
    "Push the local prompts (~/.super-whisper/prompts/*.md) and dictionary (~/.super-whisper/dictionary.txt) to the ChatGPT projects.",
  )
  .option("--project <name>", "Normalizer project name.", "Transcript Normalizer")
  .option("--profile-dir <path>", "Persistent Chrome profile directory override.")
  .option("-v, --verbose", "Enable verbose browser logging.", false)
  .action(async function (this: Command) {
    const { runVoiceSyncCommand } = await import("../src/cli/voiceInput.js");
    await runVoiceSyncCommand(this.opts() as Parameters<typeof runVoiceSyncCommand>[0]);
  });

program
  .command("login")
  .description(
    "First-run setup: open Chrome with the super-whisper profile on chatgpt.com and wait for sign-in.",
  )
  .option("--profile-dir <path>", "Persistent Chrome profile directory override.")
  .option("--chatgpt-url <url>", "ChatGPT URL to open (default https://chatgpt.com/).")
  .option("--timeout <duration>", "How long to wait for the sign-in (default 10m).")
  .option("-v, --verbose", "Enable verbose browser logging.", false)
  .action(async function (this: Command) {
    const { runLoginCliCommand } = await import("../src/cli/login.js");
    await runLoginCliCommand(this.opts());
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
