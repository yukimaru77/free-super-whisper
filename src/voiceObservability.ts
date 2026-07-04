import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWhisperHomeDir } from "./whisperHome.js";
import type { ChromeClient } from "./browser/types.js";

/**
 * Observability for the voice flows, built so that a FUTURE (possibly weaker)
 * debugging agent can reconstruct exactly what happened without re-running
 * anything:
 *
 *   ~/.super-whisper/logs/
 *     trace-<runId>.jsonl        one structured event per line, per run
 *     metrics.jsonl              one summary line per run (status, timings)
 *     <runId>-failure.png        screenshot at the moment of failure
 *     <runId>-failure.json       URL + visible controls at the moment of failure
 *
 * Every logger line also lands in the trace, so the human-readable log at
 * /tmp/super-whisper-toggle.log and the machine-readable trace never diverge.
 */

export function getVoiceLogsDir(): string {
  return path.join(getWhisperHomeDir(), "logs");
}

const MAX_TRACE_RUNS = 200;

export class VoiceTrace {
  readonly runId: string;
  readonly action: string;
  private readonly startedAt: number;
  private readonly tracePath: string;
  private events = 0;
  private lastError: string | null = null;
  private finished = false;

  constructor(action: string, meta: Record<string, unknown> = {}) {
    this.action = action;
    this.startedAt = Date.now();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.runId = `${stamp}-${action}-${process.pid}`;
    mkdirSync(getVoiceLogsDir(), { recursive: true });
    this.tracePath = path.join(getVoiceLogsDir(), `trace-${this.runId}.jsonl`);
    this.event("run-start", {
      action,
      pid: process.pid,
      argv: process.argv.slice(2),
      node: process.version,
      ...meta,
    });
    try {
      pruneOldRuns();
    } catch {
      // best effort
    }
  }

  /** Records one structured event. Never throws. */
  event(step: string, data: Record<string, unknown> = {}): void {
    this.events += 1;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedAt,
      runId: this.runId,
      step,
      ...data,
    });
    try {
      appendFileSync(this.tracePath, line + "\n");
    } catch {
      // observability must never break the product
    }
  }

  /** Wraps a human logger so every line is also traced. */
  wrapLogger(logger: (message: string) => void): (message: string) => void {
    return (message: string) => {
      logger(message);
      this.event("log", { message });
    };
  }

  recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.lastError = message;
    this.event("error", { message, stack });
  }

  /** Saves a binary/text artifact next to the trace and records its path. */
  saveArtifact(name: string, content: string | Buffer): string | null {
    const artifactPath = path.join(getVoiceLogsDir(), `${this.runId}-${name}`);
    try {
      writeFileSync(artifactPath, content);
      this.event("artifact", { name, path: artifactPath });
      return artifactPath;
    } catch {
      return null;
    }
  }

  /** Closes the run and appends one line to metrics.jsonl. */
  finish(status: "ok" | "error" | "dropped", extra: Record<string, unknown> = {}): void {
    if (this.finished) return;
    this.finished = true;
    const durationMs = Date.now() - this.startedAt;
    this.event("run-end", { status, durationMs, ...extra });
    const metricsLine = JSON.stringify({
      ts: new Date().toISOString(),
      runId: this.runId,
      action: this.action,
      status,
      durationMs,
      events: this.events,
      error: this.lastError,
      ...extra,
    });
    try {
      appendFileSync(path.join(getVoiceLogsDir(), "metrics.jsonl"), metricsLine + "\n");
    } catch {
      // best effort
    }
  }
}

let activeTrace: VoiceTrace | null = null;

/** The runner layers call this through the singleton so the CLI stays the owner. */
export function setActiveVoiceTrace(trace: VoiceTrace | null): void {
  activeTrace = trace;
}

export function getActiveVoiceTrace(): VoiceTrace | null {
  return activeTrace;
}

/**
 * Captures a screenshot + DOM snapshot of the automated tab at the moment of
 * failure. This is the single highest-value artifact for a debugging agent:
 * it shows what the page ACTUALLY looked like when the selector missed.
 */
export async function captureFailureSnapshot(
  client: Pick<ChromeClient, "Page" | "Runtime">,
  label = "failure",
): Promise<void> {
  const trace = activeTrace;
  if (!trace) return;
  try {
    const shot = await client.Page.captureScreenshot({ format: "png" });
    if (shot?.data) {
      trace.saveArtifact(`${label}.png`, Buffer.from(shot.data, "base64"));
    }
  } catch (error) {
    trace.event("artifact-error", { name: `${label}.png`, message: String(error) });
  }
  try {
    const evaluated = await client.Runtime.evaluate({
      expression: `(() => {
        const dump = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],textarea,input,[contenteditable="true"]'))
          .filter((el) => el instanceof HTMLElement && el.offsetParent)
          .slice(0, 120)
          .map((el) => ({
            tag: el.tagName,
            role: el.getAttribute('role'),
            testid: el.getAttribute('data-testid'),
            aria: el.getAttribute('aria-label'),
            text: (el.textContent || '').trim().slice(0, 80),
            disabled: el.getAttribute('aria-disabled') === 'true' || Boolean(el.disabled),
          }));
        return JSON.stringify({
          url: location.href,
          title: document.title,
          readyState: document.readyState,
          visibleControls: dump,
        });
      })()`,
      returnByValue: true,
    });
    const raw = evaluated.result?.value;
    if (typeof raw === "string") {
      trace.saveArtifact(`${label}.json`, raw);
    }
  } catch (error) {
    trace.event("artifact-error", { name: `${label}.json`, message: String(error) });
  }
}

function pruneOldRuns(): void {
  const dir = getVoiceLogsDir();
  const traces = readdirSync(dir)
    .filter((name) => name.startsWith("trace-"))
    .map((name) => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of traces.slice(MAX_TRACE_RUNS)) {
    const runId = stale.name.replace(/^trace-/, "").replace(/\.jsonl$/, "");
    for (const name of readdirSync(dir)) {
      if (name.includes(runId)) {
        try {
          unlinkSync(path.join(dir, name));
        } catch {
          // best effort
        }
      }
    }
  }
}
