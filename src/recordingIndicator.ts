import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getWhisperHomeDir } from "./whisperHome.js";

const execFileAsync = promisify(execFile);

/**
 * A tiny always-on-top HUD pill ("🎙 音声受付中") shown while dictation is
 * recording, so the user can see at a glance that the mic is live. It is a
 * separate native process (compiled once from the Swift source below into
 * ~/.super-whisper/bin/super-whisper-hud); it never takes focus, ignores the
 * mouse, and self-terminates after 15 minutes as a crash safety net. When
 * swiftc is unavailable the indicator degrades to a macOS notification.
 */

const HUD_SOURCE = `import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let text = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "🎙 REC"
let colorName = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "red"

let tf = NSTextField(labelWithString: text)
tf.textColor = .white
tf.font = .boldSystemFont(ofSize: 13)
tf.sizeToFit()

let padH: CGFloat = 14, padV: CGFloat = 7
let width = tf.frame.width + padH * 2
let height = tf.frame.height + padV * 2
let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
let rect = NSRect(x: screen.maxX - width - 16, y: screen.maxY - height - 10, width: width, height: height)

let panel = NSPanel(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.level = .statusBar
panel.isOpaque = false
panel.backgroundColor = .clear
panel.hasShadow = true
panel.ignoresMouseEvents = true
panel.hidesOnDeactivate = false
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

let bg = NSView(frame: NSRect(x: 0, y: 0, width: width, height: height))
bg.wantsLayer = true
let pillColor = colorName == "amber"
    ? NSColor(calibratedRed: 0.95, green: 0.55, blue: 0.05, alpha: 0.93)
    : NSColor(calibratedRed: 0.86, green: 0.12, blue: 0.16, alpha: 0.93)
bg.layer?.backgroundColor = pillColor.cgColor
bg.layer?.cornerRadius = height / 2
tf.frame.origin = NSPoint(x: padH, y: padV)
bg.addSubview(tf)
panel.contentView = bg
panel.orderFrontRegardless()

// Gentle pulse so "recording" reads as live, not stuck. The amber
// "working" pill stays steady so the two states look different.
if colorName != "amber" {
    var visible = true
    Timer.scheduledTimer(withTimeInterval: 0.9, repeats: true) { _ in
        visible.toggle()
        panel.animator().alphaValue = visible ? 1.0 : 0.55
    }
}

// Crash safety: never outlive a plausible recording session.
DispatchQueue.main.asyncAfter(deadline: .now() + 900) { exit(0) }
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
app.run()
`;

function getHudBinaryPath(): string {
  return path.join(getWhisperHomeDir(), "bin", "super-whisper-hud-v2");
}

function getHudPidPath(): string {
  return path.join(getWhisperHomeDir(), "indicator.pid");
}

async function ensureHudBinary(logger: (message: string) => void): Promise<string | null> {
  const binary = getHudBinaryPath();
  if (existsSync(binary)) {
    return binary;
  }
  try {
    await execFileAsync("xcrun", ["--find", "swiftc"], { timeout: 10_000 });
  } catch {
    return null; // no Swift toolchain — notification fallback
  }
  try {
    mkdirSync(path.dirname(binary), { recursive: true });
    const source = path.join(getWhisperHomeDir(), "bin", "super-whisper-hud-v2.swift");
    writeFileSync(source, HUD_SOURCE);
    logger("[voice] Building the recording indicator (one-time, a few seconds)...");
    await execFileAsync("swiftc", ["-O", source, "-o", binary], { timeout: 120_000 });
    return binary;
  } catch (error) {
    logger(`[voice] Could not build the recording indicator (${String(error).slice(0, 120)}); falling back to notifications.`);
    return null;
  }
}

/** Shows the recording pill (or a notification fallback). Never throws. */
export async function showRecordingIndicator(
  label: string,
  logger: (message: string) => void,
  color: "red" | "amber" = "red",
): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await hideRecordingIndicator(); // never stack two pills
    const binary = await ensureHudBinary(logger);
    if (binary) {
      const child = spawn(binary, [label, color], { detached: true, stdio: "ignore" });
      child.unref();
      if (child.pid) {
        writeFileSync(getHudPidPath(), String(child.pid));
      }
      return;
    }
    await execFileAsync(
      "osascript",
      ["-e", `display notification ${JSON.stringify(label)} with title "super-whisper"`],
      { timeout: 5000 },
    ).catch(() => undefined);
  } catch {
    // indicator must never break dictation
  }
}

/** Removes the recording pill if one is up. Never throws. */
export async function hideRecordingIndicator(): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    const pid = Number(readFileSync(getHudPidPath(), "utf8").trim());
    if (Number.isFinite(pid) && pid > 1) {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // no pid file or already gone
  }
  try {
    unlinkSync(getHudPidPath());
  } catch {
    // best effort
  }
}
