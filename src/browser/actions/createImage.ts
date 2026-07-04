import type { ChromeClient, BrowserLogger } from "../types.js";
import {
  COMPOSER_PLUS_BUTTON,
  CREATE_IMAGE_DROPDOWN_ITEM_TEXT,
  CREATE_IMAGE_PILL_LABEL,
} from "../constants.js";
import { buildClickDispatcher } from "./domEvents.js";
import { BrowserAutomationError } from "../../oracle/errors.js";

type ActivateCreateImageOutcome =
  | { status: "activated" }
  | { status: "already-active" }
  | { status: "plus-button-missing" }
  | { status: "dropdown-item-missing"; available?: string[] }
  | { status: "pill-not-confirmed" };

/**
 * Activates ChatGPT's Create image tool before submitting image-generation prompts.
 */
export async function activateCreateImageTool(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
): Promise<void> {
  const outcome = await Runtime.evaluate({
    expression: buildActivateCreateImageExpression(),
    awaitPromise: true,
    returnByValue: true,
  });
  const result = outcome.result?.value as ActivateCreateImageOutcome | undefined;

  switch (result?.status) {
    case "activated":
      logger("[browser] Create image tool activated");
      return;
    case "already-active":
      logger("[browser] Create image tool already active");
      return;
    case "plus-button-missing":
      throw new BrowserAutomationError(
        "Could not find the composer plus button to activate Create image.",
        { stage: "create-image-activate", code: "plus-button-missing" },
      );
    case "dropdown-item-missing": {
      const hint = result.available?.length
        ? ` Available options: ${result.available.join(", ")}`
        : "";
      throw new BrowserAutomationError(
        `"Create image" option not found in composer dropdown.${hint} ` +
          "This feature may require a ChatGPT Plus or Pro subscription.",
        { stage: "create-image-activate", code: "dropdown-item-missing" },
      );
    }
    case "pill-not-confirmed":
      throw new BrowserAutomationError(
        "Create image pill did not appear after selection. The UI may have changed.",
        { stage: "create-image-activate", code: "pill-not-confirmed" },
      );
    default:
      throw new BrowserAutomationError("Unexpected result from Create image activation.", {
        stage: "create-image-activate",
      });
  }
}

function buildActivateCreateImageExpression(): string {
  const plusBtnSelector = JSON.stringify(COMPOSER_PLUS_BUTTON);
  const targetText = JSON.stringify(CREATE_IMAGE_DROPDOWN_ITEM_TEXT);
  const pillLabel = JSON.stringify(CREATE_IMAGE_PILL_LABEL);

  return `(async () => {
    ${buildClickDispatcher()}

    const normalize = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const compact = (value) => normalize(value).replace(/\\s+/g, '');
    const isVisible = (node) => {
      if (!node || typeof node.getBoundingClientRect !== 'function') return false;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle?.(node);
      return !style || (style.visibility !== 'hidden' && style.display !== 'none');
    };
    const findCreateImagePill = () => {
      const label = ${pillLabel}.toLowerCase();
      const candidates = document.querySelectorAll(
        '[data-testid="composer-footer-actions"], .__composer-pill-composite, .__composer-pill, [class*="composer-pill"], button[aria-label]'
      );
      for (const node of candidates) {
        if (!isVisible(node)) continue;
        const text = normalize(node.textContent || '');
        const textCompact = compact(node.textContent || '');
        const aria = normalize(node.getAttribute?.('aria-label') ||
          node.querySelector?.('button')?.getAttribute?.('aria-label') ||
          '');
        if (aria.includes(label) && aria.includes('click to remove')) {
          return node;
        }
        if (text === label || text.startsWith(label + ' ')) {
          return node;
        }
        if (
          node.matches?.('[data-testid="composer-footer-actions"]') &&
          text.includes(label) &&
          !text.includes('create image')
        ) {
          return node;
        }
        if (
          textCompact === label ||
          textCompact.startsWith(label + 'auto') ||
          textCompact.startsWith(label + 'square') ||
          textCompact.startsWith(label + 'portrait') ||
          textCompact.startsWith(label + 'landscape') ||
          textCompact.startsWith(label + '1:') ||
          textCompact.startsWith(label + '4:') ||
          textCompact.startsWith(label + '16:')
        ) {
          return node;
        }
      }
      return null;
    };

    const waitForPill = () => new Promise((resolve) => {
      let elapsed = 0;
      const tick = () => {
        if (findCreateImagePill()) {
          resolve(true); return;
        }
        elapsed += 200;
        if (elapsed > 5000) { resolve(false); return; }
        setTimeout(tick, 200);
      };
      setTimeout(tick, 200);
    });

    const collectMenuItems = () => Array.from(document.querySelectorAll(
      '[data-radix-collection-item], [role="menuitem"], [role="menuitemradio"], [role="option"], [cmdk-item], button'
    )).filter((item) => isVisible(item) && normalize(item.textContent || ''));

    const waitForDropdown = () => new Promise((resolve) => {
      let elapsed = 0;
      const tick = () => {
        const items = collectMenuItems();
        if (items.length > 0) { resolve(items); return; }
        elapsed += 150;
        if (elapsed > 3000) { resolve(null); return; }
        setTimeout(tick, 150);
      };
      setTimeout(tick, 150);
    });

    if (findCreateImagePill()) {
      return { status: 'already-active' };
    }

    const plusBtn = document.querySelector(${plusBtnSelector}) ||
      Array.from(document.querySelectorAll('button')).find(
        b => normalize(b.getAttribute('aria-label') || '').includes('add files')
      );
    if (!plusBtn) return { status: 'plus-button-missing' };
    dispatchClickSequence(plusBtn);

    const items = await waitForDropdown();
    if (!items) return { status: 'dropdown-item-missing', available: [] };

    const target = ${targetText}.toLowerCase();
    let match = null;
    const available = [];
    for (const item of items) {
      const text = (item.textContent || '').trim().replace(/\\s+/g, ' ');
      if (text && !available.includes(text)) available.push(text);
      if (text.toLowerCase() === target) {
        match = item;
      }
    }
    if (!match) return { status: 'dropdown-item-missing', available };

    dispatchClickSequence(match);
    const pillConfirmed = await waitForPill();
    return pillConfirmed ? { status: 'activated' } : { status: 'pill-not-confirmed' };
  })()`;
}

export function buildActivateCreateImageExpressionForTest(): string {
  return buildActivateCreateImageExpression();
}
