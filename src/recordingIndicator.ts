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

// Position: just above-right of the text caret in the focused field (via the
// Accessibility API). Fallbacks: focused window's top-right, then screen
// top-right. AX coordinates are top-left-origin; AppKit wants bottom-left.
func axToAppKit(_ r: CGRect) -> NSRect {
    let full = NSScreen.screens.first?.frame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
    return NSRect(x: r.origin.x, y: full.maxY - r.origin.y - r.height, width: r.width, height: r.height)
}
func caretRect() -> NSRect? {
    let systemWide = AXUIElementCreateSystemWide()
    var focusedRef: AnyObject?
    guard AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
          let focusedAny = focusedRef, CFGetTypeID(focusedAny) == AXUIElementGetTypeID() else { return nil }
    let focused = focusedAny as! AXUIElement
    var rangeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success,
          let range = rangeRef else { return nil }
    var boundsRef: AnyObject?
    guard AXUIElementCopyParameterizedAttributeValue(focused, kAXBoundsForRangeParameterizedAttribute as CFString, range, &boundsRef) == .success,
          let boundsAny = boundsRef, CFGetTypeID(boundsAny) == AXValueGetTypeID() else { return nil }
    var r = CGRect.zero
    guard AXValueGetValue(boundsAny as! AXValue, .cgRect, &r) else { return nil }
    // Some fields answer .success with garbage (all zeros, or a zero-height
    // rect at the screen origin). A real caret has a plausible line height
    // and sits inside an actual screen.
    guard r.height >= 6, r.height <= 80 else { return nil }
    guard r.origin.x != 0 || r.origin.y != 0 else { return nil }
    let converted = axToAppKit(r)
    let onSomeScreen = NSScreen.screens.contains { $0.frame.insetBy(dx: -4, dy: -4).contains(NSPoint(x: converted.midX, y: converted.midY)) }
    guard onSomeScreen else { return nil }
    return converted
}
func focusedWindowRect() -> NSRect? {
    let systemWide = AXUIElementCreateSystemWide()
    var appRef: AnyObject?
    guard AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &appRef) == .success,
          let appAny = appRef, CFGetTypeID(appAny) == AXUIElementGetTypeID() else { return nil }
    var winRef: AnyObject?
    guard AXUIElementCopyAttributeValue(appAny as! AXUIElement, kAXFocusedWindowAttribute as CFString, &winRef) == .success,
          let winAny = winRef, CFGetTypeID(winAny) == AXUIElementGetTypeID() else { return nil }
    let win = winAny as! AXUIElement
    var posRef: AnyObject?, sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &sizeRef) == .success else { return nil }
    var pos = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(posRef as! AXValue, .cgPoint, &pos), AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
    return axToAppKit(CGRect(origin: pos, size: size))
}
let hudLog = FileHandle(forWritingAtPath: NSString(string: "~/.super-whisper/logs/hud.log").expandingTildeInPath)
func logLine(_ message: String) {
    let line = ISO8601DateFormatter().string(from: Date()) + " " + message + "\\n"
    if let handle = hudLog { handle.seekToEndOfFile(); handle.write(line.data(using: .utf8)!) }
    else { try? line.write(toFile: NSString(string: "~/.super-whisper/logs/hud.log").expandingTildeInPath, atomically: false, encoding: .utf8) }
}
func pillOrigin() -> NSPoint {
    if let caret = caretRect() {
        logLine("source=caret rect=" + String(describing: caret))
        return NSPoint(x: caret.maxX + 10, y: caret.maxY + 8)
    }
    if let win = focusedWindowRect() {
        logLine("source=window rect=" + String(describing: win))
        // Bottom-left of the focused window: near where text usually flows,
        // without covering the title bar or trafficlights.
        return NSPoint(x: win.minX + 16, y: win.minY + 12)
    }
    logLine("source=screen fallback")
    return NSPoint(x: screen.maxX - width - 16, y: screen.maxY - height - 10)
}
func clamped(_ p: NSPoint) -> NSPoint {
    var x = p.x, y = p.y
    if x + width > screen.maxX - 4 { x = screen.maxX - width - 4 }
    if x < screen.minX + 4 { x = screen.minX + 4 }
    if y + height > screen.maxY - 4 { y = p.y - height - 40 }
    if y < screen.minY + 4 { y = screen.minY + 4 }
    return NSPoint(x: x, y: y)
}
let origin = clamped(pillOrigin())
let rect = NSRect(x: origin.x, y: origin.y, width: width, height: height)

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

// Follow the caret if it moves (throttled; jumps only on real change).
Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
    let next = clamped(pillOrigin())
    let current = panel.frame.origin
    if abs(next.x - current.x) > 24 || abs(next.y - current.y) > 24 {
        panel.setFrameOrigin(next)
    }
}

// Crash safety: never outlive a plausible recording session.
DispatchQueue.main.asyncAfter(deadline: .now() + 900) { exit(0) }
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
app.run()
`;

function getHudBinaryPath(): string {
  return path.join(getWhisperHomeDir(), "bin", "super-whisper-hud-v6");
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
    const source = path.join(getWhisperHomeDir(), "bin", "super-whisper-hud-v6.swift");
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
