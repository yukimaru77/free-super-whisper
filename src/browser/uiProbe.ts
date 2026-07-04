import type { BrowserLogger, ChromeClient } from "./types.js";
import {
  ASSISTANT_ROLE_SELECTOR,
  COMPOSER_MODEL_SIGNAL_SELECTOR,
  COMPOSER_PLUS_BUTTON,
  CONVERSATION_TURN_SELECTOR,
  COPY_BUTTON_SELECTOR,
  FILE_INPUT_SELECTORS,
  FINISHED_ACTIONS_SELECTOR,
  INPUT_SELECTORS,
  MENU_CONTAINER_SELECTOR,
  MODEL_BUTTON_SELECTOR,
  SEND_BUTTON_SELECTORS,
  STOP_BUTTON_SELECTOR,
} from "./constants.js";

/**
 * When a probe target is expected to be present on a healthy ChatGPT page:
 * - "composer": once the prompt composer is ready (before/after submission).
 * - "conversation": once at least one turn exists in the conversation.
 * - "transient": only present in specific moments (streaming, open menu, text
 *   typed, ...) — recorded for debugging but never treated as missing.
 */
export type UiProbePhase = "composer" | "conversation";
export type UiProbeExpectation = UiProbePhase | "transient";

export interface UiProbeTarget {
  /** Stable name used in logs/diagnostics; keep in sync with constants.ts. */
  name: string;
  selectors: readonly string[];
  expectedWhen: UiProbeExpectation;
}

/**
 * Registry of every ChatGPT UI element oracle automation depends on. When the
 * ChatGPT frontend changes its DOM, the probe report pinpoints which named
 * element stopped matching instead of leaving only a generic timeout.
 */
export const UI_PROBE_TARGETS: readonly UiProbeTarget[] = [
  { name: "composer-input", selectors: INPUT_SELECTORS, expectedWhen: "composer" },
  { name: "composer-plus-button", selectors: [COMPOSER_PLUS_BUTTON], expectedWhen: "composer" },
  {
    name: "composer-footer-actions",
    selectors: [COMPOSER_MODEL_SIGNAL_SELECTOR],
    expectedWhen: "composer",
  },
  { name: "model-switcher", selectors: [MODEL_BUTTON_SELECTOR], expectedWhen: "composer" },
  { name: "file-input", selectors: FILE_INPUT_SELECTORS, expectedWhen: "transient" },
  { name: "send-button", selectors: SEND_BUTTON_SELECTORS, expectedWhen: "transient" },
  { name: "stop-button", selectors: [STOP_BUTTON_SELECTOR], expectedWhen: "transient" },
  { name: "menu-container", selectors: [MENU_CONTAINER_SELECTOR], expectedWhen: "transient" },
  {
    name: "conversation-turns",
    selectors: [CONVERSATION_TURN_SELECTOR],
    expectedWhen: "conversation",
  },
  { name: "assistant-turn", selectors: [ASSISTANT_ROLE_SELECTOR], expectedWhen: "conversation" },
  { name: "finished-actions", selectors: [FINISHED_ACTIONS_SELECTOR], expectedWhen: "transient" },
  { name: "copy-turn-button", selectors: [COPY_BUTTON_SELECTOR], expectedWhen: "transient" },
];

export interface UiProbeTargetResult {
  name: string;
  /** First selector (from the target's list) that matched, or null. */
  matchedSelector: string | null;
  count: number;
}

export interface UiProbeResult {
  url: string;
  title: string;
  readyState: string;
  targets: UiProbeTargetResult[];
}

export function buildUiProbeExpression(
  targets: readonly UiProbeTarget[] = UI_PROBE_TARGETS,
): string {
  const spec = targets.map((target) => ({ name: target.name, selectors: target.selectors }));
  return `(() => {
    const targets = ${JSON.stringify(spec)};
    const results = targets.map((target) => {
      let matchedSelector = null;
      let count = 0;
      for (const selector of target.selectors) {
        let nodes;
        try {
          nodes = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        if (nodes.length > 0) {
          if (matchedSelector === null) {
            matchedSelector = selector;
            count = nodes.length;
          }
        }
      }
      return { name: target.name, matchedSelector, count };
    });
    return {
      url: typeof location === 'object' ? location.href : '',
      title: document.title || '',
      readyState: document.readyState || '',
      targets: results,
    };
  })()`;
}

function normalizeUiProbeValue(value: unknown): UiProbeResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { url?: unknown; title?: unknown; readyState?: unknown; targets?: unknown };
  if (!Array.isArray(raw.targets)) {
    return null;
  }
  const targets: UiProbeTargetResult[] = [];
  for (const entry of raw.targets) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as { name?: unknown; matchedSelector?: unknown; count?: unknown };
    if (typeof item.name !== "string") {
      continue;
    }
    targets.push({
      name: item.name,
      matchedSelector: typeof item.matchedSelector === "string" ? item.matchedSelector : null,
      count: typeof item.count === "number" ? item.count : 0,
    });
  }
  return {
    url: typeof raw.url === "string" ? raw.url : "",
    title: typeof raw.title === "string" ? raw.title : "",
    readyState: typeof raw.readyState === "string" ? raw.readyState : "",
    targets,
  };
}

export async function probeChatGptUi(
  Runtime: ChromeClient["Runtime"],
  targets: readonly UiProbeTarget[] = UI_PROBE_TARGETS,
): Promise<UiProbeResult | null> {
  const { result } = await Runtime.evaluate({
    expression: buildUiProbeExpression(targets),
    returnByValue: true,
  });
  return normalizeUiProbeValue(result?.value);
}

export function formatUiProbeReport(probe: UiProbeResult): string {
  const parts = probe.targets.map((target) =>
    target.matchedSelector ? `${target.name}=ok(${target.count})` : `${target.name}=missing`,
  );
  return `[ui-probe] ${parts.join(" ")}`;
}

/**
 * Names of targets that should match in the given phase but did not. A
 * non-empty result is the primary "ChatGPT UI probably changed" signal.
 */
export function missingUiProbeTargets(
  probe: UiProbeResult,
  phase: UiProbePhase,
  targets: readonly UiProbeTarget[] = UI_PROBE_TARGETS,
): string[] {
  const expected = new Set(
    targets.filter((target) => target.expectedWhen === phase).map((target) => target.name),
  );
  return probe.targets
    .filter((target) => expected.has(target.name) && !target.matchedSelector)
    .map((target) => target.name);
}

/**
 * Best-effort probe + log for failure paths. Never throws; returns the probe
 * so callers can attach it to error details or diagnostics artifacts.
 */
export async function logUiProbeReport(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  context: string,
): Promise<UiProbeResult | null> {
  try {
    const probe = await probeChatGptUi(Runtime);
    if (!probe) {
      logger(`[ui-probe] (${context}) probe returned no data`);
      return null;
    }
    logger(`${formatUiProbeReport(probe)} (${context})`);
    return probe;
  } catch {
    return null;
  }
}

/**
 * Warn-only preflight: called once the composer is ready. Logs a loud warning
 * naming each expected-but-missing UI element so ChatGPT frontend changes are
 * visible in the session log even when the run later fails elsewhere.
 */
export async function warnOnUnexpectedChatGptUi(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  phase: UiProbePhase,
  context: string,
): Promise<UiProbeResult | null> {
  try {
    const probe = await probeChatGptUi(Runtime);
    if (!probe) {
      return null;
    }
    const missing = missingUiProbeTargets(probe, phase);
    if (missing.length > 0) {
      logger(
        `[ui-probe] ChatGPT UI may have changed (${context}): ` +
          `no selector matched for ${missing.join(", ")}. ` +
          `Update src/browser/constants.ts if the ChatGPT frontend was redesigned.`,
      );
    } else if (logger.verbose) {
      logger(`${formatUiProbeReport(probe)} (${context})`);
    }
    return probe;
  } catch {
    return null;
  }
}
