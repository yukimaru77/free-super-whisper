import type { BrowserLogger, ChromeClient } from "../types.js";
import {
  labelAlternation,
  CANCEL_WORDS,
  DELETE_WORDS,
  PIN_WORDS,
  SEND_MESSAGE_PHRASES,
  SEND_WORDS,
  VOICE_WORDS,
} from "../uiLabels.js";

// Regex alternations for the in-page scorers, sourced from the multilingual
// UI-label dictionary (src/browser/uiLabels.ts). Bare "pin" needs the word
// boundary so it cannot match inside e.g. "typing".
const PIN_RE = labelAlternation(PIN_WORDS.filter((w) => w !== "pin")) + "|\\bpin\\b";
const VOICE_RE = labelAlternation(VOICE_WORDS);
const SEND_RE = labelAlternation(SEND_WORDS);
const SENDMSG_RE = labelAlternation(SEND_MESSAGE_PHRASES);
const CANCELISH_RE = labelAlternation(CANCEL_WORDS);
const DELETE_RE = labelAlternation(DELETE_WORDS);
// Cancel/close words that may NOT nuke a finish button ("Stop dictation" is a
// legitimate submit label in some locales, so the stop-family stays out).
const FINISH_EXCLUDE_RE = labelAlternation([
  ...SEND_MESSAGE_PHRASES,
  "cancel", "キャンセル", "取消", "취소", "cancelar", "annuler", "abbrechen", "отмена",
  "close", "閉じる", "关闭", "關閉", "닫기", "cerrar", "fermer", "schließen", "schliessen", "fechar", "закрыть",
  "clear", "dismiss", "trash", "remove",
  ...DELETE_WORDS,
]);
const BEGIN_RE = "start|begin|開始|开始|시작|iniciar|commencer|démarrer|demarrer|starten|começar|comecar|начал|начать";

import { INPUT_SELECTORS, SEND_BUTTON_SELECTORS } from "../constants.js";
import { logDomFailure } from "../domDebug.js";
import { buildClickDispatcher } from "./domEvents.js";
import { delay } from "../utils.js";

export interface VoiceButtonClickResult {
  clicked: boolean;
  label?: string;
  testId?: string | null;
  score?: number;
  candidates?: string[];
}

/**
 * ChatGPT shows one-time onboarding popovers ("Got it" / 知道了 / 明白了 …)
 * that sit on top of the composer and swallow clicks — observed live when
 * the account language changes. Dismiss them before driving the composer.
 */
export async function dismissOnboardingBubbles(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
): Promise<void> {
  const result = await Runtime.evaluate({
    expression: `(() => {
      ${buildClickDispatcher()}
      const texts = ['got it', '知道了', '明白了', 'わかりました', '了解しました', '알겠습니다', 'entendido', 'compris', 'verstanden', 'entendi', 'понятно'];
      let dismissed = 0;
      for (const btn of Array.from(document.querySelectorAll('button'))) {
        if (!(btn instanceof HTMLElement) || !btn.offsetParent) continue;
        const label = (btn.textContent || '').trim().toLowerCase();
        if (texts.includes(label)) {
          dispatchClickSequence(btn);
          dismissed += 1;
        }
      }
      return dismissed;
    })()`,
    returnByValue: true,
  });
  const dismissed = Number(result.result?.value ?? 0);
  if (dismissed > 0) {
    logger(`[voice] Dismissed ${dismissed} onboarding popover(s).`);
  }
}

export async function startVoiceInput(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  timeoutMs = 30_000,
): Promise<VoiceButtonClickResult> {
  const result = await waitForVoiceButtonClick(Runtime, "start", timeoutMs);
  if (!result.clicked) {
    await logDomFailure(Runtime, logger, "voice-input-start");
    throw new Error(
      result.candidates && result.candidates.length > 0
        ? `Failed to find ChatGPT voice input button. Visible buttons: ${result.candidates.join(" | ")}`
        : "Failed to find ChatGPT voice input button.",
    );
  }
  logger(`[voice] Started ChatGPT voice input${result.label ? ` via "${result.label}"` : ""}.`);
  return result;
}

export async function finishVoiceInput(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  timeoutMs = 30_000,
): Promise<VoiceButtonClickResult> {
  const result = await waitForVoiceButtonClick(Runtime, "finish", timeoutMs);
  if (!result.clicked) {
    await logDomFailure(Runtime, logger, "voice-input-finish");
    throw new Error(
      result.candidates && result.candidates.length > 0
        ? `Failed to find ChatGPT voice input finish button. Visible buttons: ${result.candidates.join(" | ")}`
        : "Failed to find ChatGPT voice input finish button.",
    );
  }
  logger(`[voice] Finished ChatGPT voice input${result.label ? ` via "${result.label}"` : ""}.`);
  return result;
}

export async function cancelVoiceInput(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastResult: VoiceButtonClickResult | null = null;
  while (Date.now() < deadline) {
    const result = await Runtime.evaluate({
      expression: buildVoiceCancelExpression(),
      awaitPromise: true,
      returnByValue: true,
    });
    lastResult = normalizeVoiceButtonClickResult(result.result?.value);
    if (lastResult.clicked) {
      logger(
        `[voice] Cancelled ChatGPT voice input${lastResult.label ? ` via "${lastResult.label}"` : ""}.`,
      );
      return true;
    }
    await delay(250);
  }
  logger("[voice] No active ChatGPT voice input cancel button found.");
  return false;
}

export async function readPromptComposerText(Runtime: ChromeClient["Runtime"]): Promise<string> {
  const result = await Runtime.evaluate({
    expression: buildReadPromptComposerTextExpression(),
    awaitPromise: true,
    returnByValue: true,
  });
  return normalizeComposerText(result.result?.value);
}

export interface ComposerSnapshot {
  text: string;
  dictationActive: boolean;
  sendEnabled: boolean | null;
}

export async function readComposerSnapshot(
  Runtime: ChromeClient["Runtime"],
): Promise<ComposerSnapshot> {
  const result = await Runtime.evaluate({
    expression: buildComposerSnapshotExpression(),
    awaitPromise: true,
    returnByValue: true,
  });
  return normalizeComposerSnapshot(result.result?.value);
}

export async function waitForVoiceTranscript(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  let lastChangedAt = Date.now();

  while (Date.now() < deadline) {
    const snapshot = await readComposerSnapshot(Runtime);
    const text = snapshot.text.trim();
    if (text !== previous) {
      previous = text;
      lastChangedAt = Date.now();
    }
    // Never accept text while the dictation UI is still up: the composer only
    // receives the transcript after ChatGPT finishes processing the submission.
    // The quiet windows are generous on purpose: the web UI sometimes freezes
    // mid-render and streams the rest of the transcript seconds later —
    // accepting too early would send a truncated message.
    if (text && !snapshot.dictationActive) {
      const quietMs = snapshot.sendEnabled === true ? 1_200 : 2_500;
      if (Date.now() - lastChangedAt >= quietMs) {
        return text;
      }
    }
    await delay(250);
  }

  await logDomFailure(Runtime, logger, "voice-input-transcript-timeout");
  throw new Error(
    "Timed out waiting for ChatGPT voice transcription to appear in the message field.",
  );
}

export async function clickComposerSend(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let clicks = 0;
  while (Date.now() < deadline) {
    const result = await Runtime.evaluate({
      expression: buildSendClickExpression(),
      awaitPromise: true,
      returnByValue: true,
    });
    const value = result.result?.value as { clicked?: boolean } | undefined;
    if (value?.clicked) {
      clicks += 1;
      // Never click send twice without proof the first click was lost: a
      // duplicate click double-sends the transcript as a second conversation.
      const verifyDeadline = Date.now() + 8_000;
      while (Date.now() < verifyDeadline) {
        const verified = await Runtime.evaluate({
          expression: buildSendVerifyExpression(),
          returnByValue: true,
        });
        if ((verified.result?.value as { sent?: boolean } | undefined)?.sent) {
          logger("[voice] Submitted transcript to ChatGPT.");
          return;
        }
        await delay(300);
      }
      if (clicks >= 2) {
        break;
      }
      logger("[voice] Send click did not seem to register; retrying once.");
      continue;
    }
    await delay(250);
  }
  await logDomFailure(Runtime, logger, "voice-input-send");
  throw new Error("Failed to find an enabled ChatGPT send button for the voice transcript.");
}

function buildSendVerifyExpression(): string {
  // The message left the composer when the composer is empty again, the URL
  // moved to a conversation, or the stop-generation button appeared.
  return `(() => {
    const selectors = ${JSON.stringify(INPUT_SELECTORS)};
    const readValue = (node) => {
      if (!node) return '';
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value || '';
      return node.innerText || node.textContent || '';
    };
    const texts = selectors
      .map((selector) => document.querySelector(selector))
      .filter(Boolean)
      .map((node) => readValue(node).trim());
    const composerEmpty = texts.every((text) => text.length === 0);
    const onConversation = /\/c\//.test(location.pathname);
    const stopVisible = Boolean(document.querySelector('button[data-testid="stop-button"], [data-testid="composer-stop-button"]'));
    return { sent: composerEmpty || onConversation || stopVisible };
  })()`;
}

function buildSendClickExpression(): string {
  return `(() => {
    ${buildClickDispatcher()}
    const selectors = ${JSON.stringify(SEND_BUTTON_SELECTORS)};
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (node.disabled || node.getAttribute('aria-disabled') === 'true' || node.getAttribute('disabled') != null) continue;
        // Single synthetic click, like upstream oracle. A second .click() here
        // once double-sent every transcript (two identical conversations).
        dispatchClickSequence(node);
        return { clicked: true };
      }
    }
    return { clicked: false };
  })()`;
}

async function waitForVoiceButtonClick(
  Runtime: ChromeClient["Runtime"],
  mode: "start" | "finish",
  timeoutMs: number,
): Promise<VoiceButtonClickResult> {
  const deadline = Date.now() + timeoutMs;
  let lastResult: VoiceButtonClickResult | null = null;
  while (Date.now() < deadline) {
    const result = await Runtime.evaluate({
      expression: buildVoiceButtonClickExpression(mode),
      awaitPromise: true,
      returnByValue: true,
    });
    lastResult = normalizeVoiceButtonClickResult(result.result?.value);
    if (lastResult.clicked) {
      return lastResult;
    }
    await delay(250);
  }
  return lastResult ?? { clicked: false };
}

function normalizeVoiceButtonClickResult(value: unknown): VoiceButtonClickResult {
  if (!value || typeof value !== "object") {
    return { clicked: false };
  }
  const record = value as Record<string, unknown>;
  const candidates = Array.isArray(record.candidates)
    ? record.candidates.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return {
    clicked: record.clicked === true,
    label: typeof record.label === "string" ? record.label : undefined,
    testId: typeof record.testId === "string" ? record.testId : null,
    score: typeof record.score === "number" ? record.score : undefined,
    candidates,
  };
}

function normalizeComposerSnapshot(value: unknown): ComposerSnapshot {
  if (!value || typeof value !== "object") {
    return { text: "", dictationActive: false, sendEnabled: null };
  }
  const record = value as Record<string, unknown>;
  return {
    text: typeof record.text === "string" ? record.text : "",
    dictationActive: record.dictationActive === true,
    sendEnabled: typeof record.sendEnabled === "boolean" ? record.sendEnabled : null,
  };
}

function normalizeComposerText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const texts = Array.isArray(record.texts)
    ? record.texts.filter((entry): entry is string => typeof entry === "string")
    : [];
  const direct = typeof record.text === "string" ? record.text : "";
  return [direct, ...texts].sort((a, b) => b.length - a.length)[0] ?? "";
}

function buildReadPromptComposerTextExpression(): string {
  return `(() => {
    const selectors = ${JSON.stringify(INPUT_SELECTORS)};
    const readValue = (node) => {
      if (!node) return '';
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        return node.value || '';
      }
      return node.innerText || node.textContent || '';
    };
    const texts = Array.from(new Set(
      selectors
        .map((selector) => document.querySelector(selector))
        .filter(Boolean)
        .map((node) => readValue(node).trim())
        .filter(Boolean)
    ));
    return { text: texts.sort((a, b) => b.length - a.length)[0] || '', texts };
  })()`;
}

function buildComposerSnapshotExpression(): string {
  return `(() => {
    ${buildVoiceButtonHelpers()}
    const selectors = ${JSON.stringify(INPUT_SELECTORS)};
    const readValue = (node) => {
      if (!node) return '';
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        return node.value || '';
      }
      return node.innerText || node.textContent || '';
    };
    const texts = Array.from(new Set(
      selectors
        .map((selector) => document.querySelector(selector))
        .filter(Boolean)
        .map((node) => readValue(node).trim())
        .filter(Boolean)
    ));
    const text = texts.sort((a, b) => b.length - a.length)[0] || '';
    const dictation = findBestVoiceButton('finish');
    const dictationActive = Boolean(dictation.best && dictation.best.score >= 60);
    const sendNode = document.querySelector(
      '[data-testid="send-button"], button[data-testid="composer-send-button"], #composer-submit-button'
    );
    const sendEnabled = sendNode instanceof HTMLElement
      ? isVisible(sendNode) && !isDisabled(sendNode)
      : null;
    return { text, dictationActive, sendEnabled };
  })()`;
}

function buildVoiceCancelExpression(): string {
  return `(() => {
    ${buildClickDispatcher()}
    return clickBestVoiceButton('cancel');

    ${buildVoiceButtonHelpers()}
  })()`;
}

function buildVoiceButtonClickExpression(mode: "start" | "finish"): string {
  return `(() => {
    ${buildClickDispatcher()}
    return clickBestVoiceButton(${JSON.stringify(mode)});

    ${buildVoiceButtonHelpers()}
  })()`;
}

function buildVoiceButtonHelpers(): string {
  return `
    function normalize(value) {
      return String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    }
    function isVisible(node) {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(node);
      return Boolean(style) &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.visibility !== 'collapse' &&
        Number.parseFloat(style.opacity || '1') > 0;
    }
    function isDisabled(node) {
      return Boolean(
        node.disabled ||
        node.getAttribute('aria-disabled') === 'true' ||
        node.getAttribute('disabled') != null
      );
    }
    function labelFor(node) {
      const pieces = [];
      for (const attr of ['aria-label', 'title', 'data-testid', 'data-tooltip', 'data-tooltip-content']) {
        const value = node.getAttribute?.(attr);
        if (value) pieces.push(value);
      }
      const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text) pieces.push(text);
      return pieces.join(' ').trim();
    }
    function normalizedLabelFor(node) {
      return normalize(labelFor(node));
    }
    function visibleButtonCandidates() {
      // Stay inside the composer/dialog area: page-level buttons (pinned
      // conversations, sidebar entries) can carry voice-like labels and must
      // never be candidates. Fall back to body only when no composer exists.
      const composerRoots = [
        document.querySelector('form'),
        document.querySelector('[data-testid*="composer"]'),
        ...Array.from(document.querySelectorAll('[role="dialog"], dialog'))
      ].filter(Boolean);
      const roots = composerRoots.length > 0 ? composerRoots : [document.body];
      const seen = new Set();
      const out = [];
      for (const root of roots) {
        for (const node of Array.from(root.querySelectorAll('button,[role="button"]'))) {
          if (!(node instanceof HTMLElement)) continue;
          if (seen.has(node)) continue;
          seen.add(node);
          if (!isVisible(node) || isDisabled(node)) continue;
          out.push(node);
        }
      }
      return out;
    }
    function scoreStart(node, label) {
      let score = 0;
      const testId = normalize(node.getAttribute('data-testid'));
      if (new RegExp('voice mode|advanced voice|голосовой режим|screen share|attach|file|plus|add files?|tools?|' + '${PIN_RE}').test(label)) return -1000;
      if (/composer.*(speech|dictat|mic|microphone)|speech|dictat|mic|microphone/.test(testId)) score += 120;
      if (/dictat|dictation|speech|microphone|\\bmic\\b|マイク|听写|聽寫|받아쓰기|麦克风|麥克風|마이크|dictado|dictée|dictee|diktat|ditado|диктов|микрофон/.test(label)) score += 100;
      if (/voice input|音声入力|语音输入|語音輸入|음성 입력|entrada de voz|saisie vocale|spracheingabe|голосовой ввод/.test(label)) score += 90;
      if (/\\bvoice\\b|音声|语音|語音|음성|\\bvoz\\b|\\bvoix\\b|голос/.test(label)) score += 35;
      if (new RegExp('${BEGIN_RE}' + '|record|input|入力').test(label)) score += 15;
      if (new RegExp('${SEND_RE}' + '|' + '${CANCELISH_RE}' + '|' + '${DELETE_RE}' + '|remove').test(label)) score -= 120;
      return score;
    }
    function scoreFinish(node, label) {
      let score = 0;
      const testId = normalize(node.getAttribute('data-testid'));
      if (/send-button|composer-send|plus|attach|file|tools?/.test(testId)) return -1000;
      if (new RegExp('add files?|attach|' + '${FINISH_EXCLUDE_RE}' + '|' + '${PIN_RE}').test(label)) return -1000;
      if (/composer.*(speech|dictat|mic|microphone)|speech|dictat|mic|microphone/.test(testId)) score += 100;
      if (
        /stop.*(dictat|record|voice|speech)|submit dictation|finish|done|confirm|accept|use transcription|確定|完了|停止|完成|확인|완료|중지|listo|terminé|termine|fertig|concluído|concluido|готово/.test(
          label,
        )
      ) score += 110;
      // Language-agnostic shape: a send/submit word next to a voice word is
      // the dictation-submit button in every locale.
      if (new RegExp('${SEND_RE}').test(label) && new RegExp('${VOICE_RE}').test(label)) score += 110;
      if (new RegExp('${VOICE_RE}' + '|\\\\bmic\\\\b|record').test(label)) score += 55;
      if (/check|submit voice/.test(label)) score += 35;
      if (new RegExp('${BEGIN_RE}').test(label)) score -= 40;
      return score;
    }
    function scoreCancel(node, label) {
      let score = 0;
      const testId = normalize(node.getAttribute('data-testid'));
      const voiceLike = new RegExp('${VOICE_RE}' + '|\\\\bmic\\\\b').test(label) ||
        /speech|dictat|mic|microphone|voice/.test(testId);
      if (!voiceLike) return -1000;
      if (/speech|dictat|mic|microphone|voice/.test(testId)) score += 30;
      if (new RegExp('${CANCELISH_RE}').test(label)) score += 100;
      if (new RegExp('add files?|attach|file|tools?|' + '${SENDMSG_RE}' + '|' + '${PIN_RE}').test(label)) return -1000;
      return score;
    }
    function scoreForMode(mode, node) {
      const label = normalizedLabelFor(node);
      if (!label) return -1000;
      if (mode === 'start') return scoreStart(node, label);
      if (mode === 'finish') return scoreFinish(node, label);
      return scoreCancel(node, label);
    }
    function findBestVoiceButton(mode) {
      const candidates = visibleButtonCandidates();
      const scored = candidates
        .map((node) => ({ node, score: scoreForMode(mode, node), label: labelFor(node) }))
        .sort((a, b) => b.score - a.score);
      return { best: scored[0] || null, scored };
    }
    function clickBestVoiceButton(mode) {
      const { best, scored } = findBestVoiceButton(mode);
      const visibleLabels = scored
        .slice(0, 12)
        .map((entry) => entry.label)
        .filter(Boolean);
      if (!best || best.score < 60) {
        return { clicked: false, candidates: visibleLabels };
      }
      dispatchClickSequence(best.node);

      return {
        clicked: true,
        label: best.label,
        testId: best.node.getAttribute('data-testid'),
        score: best.score,
        candidates: visibleLabels
      };
    }
  `;
}
