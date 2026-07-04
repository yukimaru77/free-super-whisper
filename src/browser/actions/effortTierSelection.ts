import type { BrowserLogger, ChromeClient } from "../types.js";
import { MODEL_BUTTON_SELECTOR } from "../constants.js";
import { buildClickDispatcher } from "./domEvents.js";

/**
 * Composer effort tiers as of 2026-07, top to bottom in the model pill menu.
 * Localized labels verified live: en ("Instant/Medium/High/Extra High/Pro
 * Extended") and ja ("最速/標準/高/最高/Pro 拡張"). zh/ko entries are
 * best-effort guesses — the ORDINAL fallback (position among the
 * menuitemradio items) is what actually makes selection language-independent,
 * so an unknown locale still picks the right tier as long as the menu order
 * is unchanged.
 */
const EFFORT_TIERS: Record<string, { index: number; labels: string[] }> = {
  instant: {
    index: 0,
    labels: ["instant", "最速", "极速", "即時", "最快", "즉시", "인스턴트"], // 极速/即時/즉시 measured 2026-07-05
  },
  medium: {
    index: 1,
    labels: ["medium", "標準", "标准", "표준", "보통", "중간", "均衡", "中", "中等"], // 중간/均衡/中 measured 2026-07-05
  },
  high: {
    index: 2,
    labels: ["high", "高", "高级", "높음"], // 高/高级/높음 measured 2026-07-05
  },
  "extra high": {
    index: 3,
    labels: ["extra high", "最高", "最高级", "최고", "매우 높음", "超高", "極高", "очень высокий"], // 매우 높음/超高/極高 measured
  },
  "pro extended": {
    index: 4,
    labels: ["pro extended", "pro 拡張", "pro 扩展", "pro 확장", "pro 延伸模式", "pro 延伸", "pro расширенный"], // 扩展/확장/延伸模式/расширенный measured
  },
};

export interface EffortTier {
  key: string;
  index: number;
  labels: string[];
}

/** Maps a desired-model string to a known effort tier, or null. */
export function effortTierFor(desiredModel: string): EffortTier | null {
  const key = desiredModel.trim().toLowerCase();
  const tier = EFFORT_TIERS[key];
  return tier ? { key, ...tier } : null;
}

export type EffortTierSelectionResult =
  | { status: "already-selected" | "switched"; label: string; via: "label" | "ordinal" }
  | { status: "button-missing" | "menu-missing" }
  | { status: "option-not-found"; options: string[] };

/**
 * Selects an effort tier in the composer model pill menu, matching localized
 * labels first and falling back to the menu POSITION when the locale is
 * unknown. Much narrower than ensureModelSelection, which is English-centric.
 */
export async function selectEffortTier(
  runtime: ChromeClient["Runtime"],
  tier: EffortTier,
  logger: BrowserLogger,
): Promise<EffortTierSelectionResult> {
  const evaluated = await runtime.evaluate({
    expression: buildEffortTierExpression(tier),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = (evaluated.result?.value ?? { status: "menu-missing" }) as EffortTierSelectionResult;
  if (value.status === "already-selected" || value.status === "switched") {
    logger(`[voice] Effort tier "${tier.key}" ${value.status} via ${value.via} (${value.label}).`);
  }
  return value;
}

function buildEffortTierExpression(tier: EffortTier): string {
  return `(() => {
    ${buildClickDispatcher()}
    const TIER = ${JSON.stringify({ index: tier.index, labels: tier.labels })};
    const BUTTON_SELECTOR = ${JSON.stringify(MODEL_BUTTON_SELECTOR)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\\s+/g, ' ');
    const labelMatches = (value) => {
      const n = norm(value);
      if (!n) return false;
      return TIER.labels.some((l) => n === l || n === l.replace(/\\s+/g, ''));
    };
    const findPill = () =>
      document.querySelector(BUTTON_SELECTOR) ??
      Array.from(document.querySelectorAll('button.__composer-pill')).find(
        (b) => b.getAttribute('aria-haspopup') === 'menu' && b.offsetParent,
      ) ?? null;
    const menuItems = () =>
      Array.from(document.querySelectorAll('[role="menu"] [role="menuitemradio"]'))
        .filter((el) => el.offsetParent);
    return (async () => {
      const pill = findPill();
      if (!pill) return { status: 'button-missing' };
      if (labelMatches(pill.textContent)) {
        return { status: 'already-selected', label: (pill.textContent ?? '').trim(), via: 'label' };
      }
      dispatchClickSequence(pill);
      let items = [];
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        items = menuItems();
        if (items.length > 0) break;
        await sleep(250);
      }
      if (items.length === 0) return { status: 'menu-missing' };
      let via = 'label';
      let target = items.find((el) => labelMatches(el.textContent));
      // Ordinal fallback: the tier menu is a fixed-order radio list; when the
      // locale's labels are unknown, pick by position (Instant = topmost).
      if (!target && items.length >= 2 && items.length <= 6 && TIER.index < items.length) {
        target = items[TIER.index];
        via = 'ordinal';
      }
      if (!target) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return {
          status: 'option-not-found',
          options: items.map((el) => (el.textContent ?? '').trim()).slice(0, 12),
        };
      }
      const targetLabel = (target.textContent ?? '').trim();
      if (target.getAttribute('aria-checked') === 'true') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { status: 'already-selected', label: targetLabel, via };
      }
      dispatchClickSequence(target);
      // Read back: the pill label should settle on the clicked tier.
      const settleDeadline = Date.now() + 4000;
      while (Date.now() < settleDeadline) {
        await sleep(200);
        const pillLabel = norm(findPill()?.textContent);
        if (pillLabel && (pillLabel === norm(targetLabel) || labelMatches(pillLabel))) {
          return { status: 'switched', label: (findPill()?.textContent ?? targetLabel).trim(), via };
        }
      }
      // The click landed but the pill did not echo the label; report what we
      // clicked so the caller can decide whether to retry.
      return { status: 'switched', label: targetLabel, via };
    })();
  })()`;
}
