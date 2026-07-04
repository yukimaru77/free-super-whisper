import type { BrowserLogger, ChromeClient } from "../types.js";
import {
  labelAlternation,
  ARCHIVE_WORDS,
  CANCEL_WORDS,
  CLOSE_LABELS,
  CREATE_CONFIRM_LABELS,
  DELETE_WORDS,
  NEW_PROJECT_LABELS,
  OPEN_PROJECT_HOME_LABELS,
  OPTIONS_WORDS,
  PROJECT_DETAILS_LABELS,
  PROJECT_SETTINGS_LABELS,
  PROJECT_WORDS,
  SAVE_LABELS,
} from "../uiLabels.js";

// In-page regex alternations from the multilingual dictionary.
const OPTIONS_RE = labelAlternation(OPTIONS_WORDS);
const ARCHIVE_RE = labelAlternation(ARCHIVE_WORDS);
const PROJECT_RE = labelAlternation(PROJECT_WORDS);
const DELETE_RE = labelAlternation(DELETE_WORDS);
const CANCELISH_RE = labelAlternation(CANCEL_WORDS);
import { navigateToChatGPT } from "./navigation.js";
import { CHATGPT_URL } from "../constants.js";
import { delay } from "../utils.js";

/**
 * Archives the currently open ChatGPT conversation via the conversation
 * "More" menu (no confirm dialog). Best-effort: returns false when any step
 * cannot be found, so callers can fall back to deletion.
 */
export async function archiveCurrentConversation(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
): Promise<boolean> {
  const evaluated = await Runtime.evaluate({
    expression: buildArchiveConversationExpression(),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = evaluated.result?.value as
    | { status: "archived" }
    | { status: "skipped" | "failed"; reason?: string; error?: string }
    | undefined;
  if (value?.status === "archived") {
    logger("[voice] Archived the ChatGPT conversation.");
    return true;
  }
  logger(
    `[voice] Conversation archive skipped (${value?.error ?? value?.reason ?? "unknown"}).`,
  );
  return false;
}

function buildArchiveConversationExpression(): string {
  return `(() => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${SHARED_DOM_HELPERS}
    const findConversationMenuButton = () => {
      const labelled = visibleElements('button,[role="button"]')
        .map((element) => ({ element, label: labelFor(element), rect: element.getBoundingClientRect() }))
        .filter(({ label }) =>
          new RegExp('${OPTIONS_RE}').test(label) &&
          !new RegExp('${PROJECT_RE}').test(label)
        );
      const headerCandidates = labelled
        .filter(({ rect }) => rect.top < 180 && rect.right > window.innerWidth - 420)
        .sort((a, b) => b.rect.right - a.rect.right);
      return headerCandidates[0]?.element ?? null;
    };
    const findArchiveMenuItem = () => {
      const menuRoots = visibleElements('[role="menu"]');
      for (const selector of ['[role="menuitem"],[role="option"]', 'button,div[tabindex]']) {
        for (const root of menuRoots) {
          for (const element of Array.from(root.querySelectorAll(selector))) {
            if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
            const label = labelFor(element);
            if (!label || new RegExp('${PROJECT_RE}').test(label)) continue;
            if (new RegExp('${ARCHIVE_RE}').test(label)) return element;
          }
        }
      }
      return null;
    };
    return (async () => {
      if (!/\\/c\\//.test(location.pathname)) {
        return { status: 'skipped', reason: 'not-a-conversation-page' };
      }
      const startUrl = location.href;
      let menuButton = null;
      const menuDeadline = Date.now() + 5000;
      while (!menuButton && Date.now() < menuDeadline) {
        menuButton = findConversationMenuButton();
        if (!menuButton) await sleep(200);
      }
      if (!menuButton) return { status: 'skipped', reason: 'conversation-menu-not-found' };
      click(menuButton);
      let archiveItem = null;
      const deadline = Date.now() + 4000;
      while (!archiveItem && Date.now() < deadline) {
        await sleep(150);
        archiveItem = findArchiveMenuItem();
      }
      if (!archiveItem) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { status: 'skipped', reason: 'archive-menu-item-not-found' };
      }
      click(archiveItem);
      // Archiving has no confirm dialog; give it a moment to commit (the page
      // usually navigates back to the project or home).
      const settleDeadline = Date.now() + 6000;
      while (Date.now() < settleDeadline) {
        await sleep(300);
        const menuStillOpen = visibleElements('[role="menu"]').length > 0;
        if (location.href !== startUrl || !menuStillOpen) {
          await sleep(1500);
          return { status: 'archived' };
        }
      }
      return { status: 'skipped', reason: 'archive-not-confirmed' };
    })().catch((error) => ({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  })()`;
}

/**
 * Deletes the currently open ChatGPT conversation via the conversation
 * "More" menu. Best-effort: returns false when any step cannot be found.
 */
export async function deleteCurrentConversation(
  Runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
): Promise<boolean> {
  const evaluated = await Runtime.evaluate({
    expression: buildDeleteConversationExpression(),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = evaluated.result?.value as
    | { status: "deleted" }
    | { status: "skipped" | "failed"; reason?: string; error?: string }
    | undefined;
  if (value?.status === "deleted") {
    logger("[voice] Deleted the ChatGPT conversation.");
    return true;
  }
  logger(
    `[voice] Conversation delete skipped (${value?.error ?? value?.reason ?? "unknown"}); it stays in the project.`,
  );
  return false;
}

function buildDeleteConversationExpression(): string {
  return `(() => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ${SHARED_DOM_HELPERS}
    const findConversationMenuButton = () => {
      // ONLY the conversation-header "…" button qualifies. The sidebar rows
      // carry look-alike labels ("... のプロジェクトオプションを開く") whose
      // menu contains a PROJECT delete — clicking that would be catastrophic,
      // so project-ish labels are excluded and there is no positional fallback.
      const labelled = visibleElements('button,[role="button"]')
        .map((element) => ({ element, label: labelFor(element), rect: element.getBoundingClientRect() }))
        .filter(({ label }) =>
          new RegExp('${OPTIONS_RE}').test(label) &&
          !new RegExp('${PROJECT_RE}').test(label)
        );
      const headerCandidates = labelled
        .filter(({ rect }) => rect.top < 180 && rect.right > window.innerWidth - 420)
        .sort((a, b) => b.rect.right - a.rect.right);
      return headerCandidates[0]?.element ?? null;
    };
    const findDeleteMenuItem = () => {
      // Fast path: stable testid (measured ko UI 2026-07-05), language-free.
      const byTestId = document.querySelector('[role="menu"] [data-testid="delete-chat-menu-item"]');
      if (byTestId instanceof HTMLElement && isVisible(byTestId)) return byTestId;
      const menuRoots = visibleElements('[role="menu"]');
      // Require an actual open menu: scanning the whole document could hit a
      // sidebar or dialog control that says "delete" but targets something else.
      // Proper menu items FIRST: a wrapping div[tabindex] can match the same
      // label in document order, and clicking the wrapper does nothing.
      for (const selector of ['[role="menuitem"],[role="option"]', 'button,div[tabindex]']) {
        for (const root of menuRoots) {
          for (const element of Array.from(root.querySelectorAll(selector))) {
            if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
            const label = labelFor(element);
            if (!label || new RegExp('${PROJECT_RE}').test(label)) continue;
            if (new RegExp('${DELETE_RE}').test(label)) return element;
          }
        }
      }
      return null;
    };
    const findDeleteConfirmButton = () => {
      // Fast path: the confirm button carries a stable testid (verified
      // 2026-07-05, ja UI: "削除する" / delete-conversation-confirm-button).
      const byTestId = document.querySelector('[data-testid="delete-conversation-confirm-button"]');
      if (byTestId instanceof HTMLElement && isVisible(byTestId)) return byTestId;
      const candidates = visibleElements(
        '[role="dialog"] button,[role="dialog"] [role="button"],[role="alertdialog"] button,dialog button'
      );
      return candidates.find((element) => {
        const label = labelFor(element);
        if (!label || new RegExp('${CANCELISH_RE}').test(label)) return false;
        if (new RegExp('${PROJECT_RE}').test(label)) return false;
        return new RegExp('${DELETE_RE}').test(label);
      }) ?? null;
    };
    return (async () => {
      if (!/\\/c\\//.test(location.pathname)) {
        return { status: 'skipped', reason: 'not-a-conversation-page' };
      }
      const startUrl = location.href;
      let menuButton = null;
      let menuDeadline = Date.now() + 5000;
      while (!menuButton && Date.now() < menuDeadline) {
        menuButton = findConversationMenuButton();
        if (!menuButton) await sleep(200);
      }
      if (!menuButton) return { status: 'skipped', reason: 'conversation-menu-not-found' };
      click(menuButton);
      let deleteItem = null;
      let deadline = Date.now() + 4000;
      while (!deleteItem && Date.now() < deadline) {
        await sleep(150);
        deleteItem = findDeleteMenuItem();
      }
      if (!deleteItem) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { status: 'skipped', reason: 'delete-menu-item-not-found' };
      }
      click(deleteItem);
      let confirmButton = null;
      deadline = Date.now() + 4000;
      while (!confirmButton && Date.now() < deadline) {
        await sleep(150);
        confirmButton = findDeleteConfirmButton();
      }
      if (!confirmButton) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { status: 'skipped', reason: 'delete-confirm-not-found' };
      }
      click(confirmButton);
      deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (location.href !== startUrl) {
          // Let the deletion commit server-side before the caller navigates
          // away — leaving immediately can revive the conversation.
          await sleep(3000);
          return { status: 'deleted' };
        }
        await sleep(200);
      }
      return { status: 'skipped', reason: 'delete-not-confirmed' };
    })().catch((error) => ({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  })()`;
}

/**
 * Creates a ChatGPT project with the given name and instructions and returns
 * its canonical /g/g-p-…/project URL. Assumes the tab is logged in.
 */
export async function createVoiceProject(options: {
  page: ChromeClient["Page"];
  runtime: ChromeClient["Runtime"];
  input: ChromeClient["Input"];
  projectName: string;
  instructions: string;
  logger: BrowserLogger;
}): Promise<string> {
  const { page, runtime, input, projectName, instructions, logger } = options;
  await navigateToChatGPT(page, runtime, CHATGPT_URL, logger);

  logger(`[voice] Creating ChatGPT project "${projectName}"...`);
  await clickByLabel(runtime, {
    include: [...NEW_PROJECT_LABELS],
    exclude: [],
    timeoutMs: 15_000,
    description: "new-project button",
  });
  await fillVisibleField(runtime, projectName, {
    scope: "dialog",
    timeoutMs: 10_000,
    description: "project name input",
  });
  await clickByLabel(runtime, {
    include: ["create project", ...CREATE_CONFIRM_LABELS],
    exclude: ["cancel", "キャンセル", "取消", "취소", "cancelar", "annuler", "abbrechen", "отмена"],
    scope: "dialog",
    timeoutMs: 10_000,
    description: "create-project confirm button",
  });
  const projectUrl = await waitForProjectLocation(runtime, 20_000);
  logger(`[voice] Project created at ${projectUrl}`);
  await setProjectInstructions(runtime, input, instructions, logger);
  return projectUrl;
}

/**
 * Opens Project settings (via the "Show project details" menu on the project
 * page), fills the Instructions textarea, and closes the dialog. There is no
 * explicit save button — closing the dialog commits the value.
 */
export async function setProjectInstructions(
  runtime: ChromeClient["Runtime"],
  input: ChromeClient["Input"],
  instructions: string,
  logger: BrowserLogger,
): Promise<void> {
  logger("[voice] Opening project settings to set instructions...");
  await clickByLabel(runtime, {
    include: [...PROJECT_DETAILS_LABELS],
    exclude: [],
    timeoutMs: 15_000,
    description: "project details menu button",
  });
  await clickByLabel(runtime, {
    include: [...PROJECT_SETTINGS_LABELS],
    exclude: [],
    timeoutMs: 10_000,
    description: "project settings menu item",
  });
  // React ignores values injected via the native setter here, so type the
  // text through CDP Input.insertText after focusing the textarea.
  const focused = await focusDialogTextarea(runtime, 10_000);
  if (!focused) {
    throw new Error("Could not find the project instructions textarea.");
  }
  await input.insertText({ text: instructions });
  await delay(300);
  const committed = await runtime.evaluate({
    expression: `(() => {
      const ta = document.querySelector('[role="dialog"] textarea, dialog textarea');
      if (!ta) return false;
      ta.blur();
      return ta.value.length > 0;
    })()`,
    returnByValue: true,
  });
  if (committed.result?.value !== true) {
    throw new Error("Project instructions did not stick in the settings textarea.");
  }
  // A "Save" button only appears once the form is dirty; closing without
  // saving discards the value. When the typed text is IDENTICAL to what was
  // already stored, the form never becomes dirty and no Save exists — that
  // is success, not failure (hit by `super-whisper sync` re-pushes).
  try {
    await clickByLabel(runtime, {
      include: [...SAVE_LABELS],
      exclude: ["cancel", "キャンセル", "取消", "취소", "cancelar", "annuler", "abbrechen", "отмена", ...DELETE_WORDS],
      scope: "dialog",
      timeoutMs: 10_000,
      description: "project settings save button",
    });
    await delay(800);
    logger("[voice] Project instructions saved.");
  } catch (error) {
    const unchanged = await runtime.evaluate({
      expression: `(() => {
        const ta = document.querySelector('[role="dialog"] textarea, dialog textarea');
        return ta ? ta.value.trim() === ${JSON.stringify(instructions.trim())} : false;
      })()`,
      returnByValue: true,
    });
    if (unchanged.result?.value !== true) {
      throw error;
    }
    logger("[voice] Project instructions already up to date; nothing to save.");
  }
  await closeSettingsDialog(runtime);
}

export const PROJECT_DICTIONARY_HEADER = "## User dictionary";
export const PROJECT_DICTIONARY_INTRO =
  "User-taught corrections. Entry format: wrong(reading) → correct. If any word or phrase in the input matches the wrong form, OR sounds like the reading (any other transcription of that sound counts too), treat it as the dictionary term and replace it with the correct form.";

/**
 * Appends dictionary lines to the project instructions WITHOUT replacing the
 * existing text: opens Project settings, puts the caret at the end of the
 * Instructions textarea, types the new entries via CDP Input.insertText, and
 * presses the dirty-state "Save" button. Returns false when every entry was
 * already present.
 */
export async function appendProjectInstructions(
  runtime: ChromeClient["Runtime"],
  input: ChromeClient["Input"],
  lines: string[],
  logger: BrowserLogger,
): Promise<boolean> {
  logger("[voice] Opening project settings to append dictionary entries...");
  await clickByLabel(runtime, {
    include: [...PROJECT_DETAILS_LABELS],
    exclude: [],
    timeoutMs: 15_000,
    description: "project details menu button",
  });
  await clickByLabel(runtime, {
    include: [...PROJECT_SETTINGS_LABELS],
    exclude: [],
    timeoutMs: 10_000,
    description: "project settings menu item",
  });
  const current = await readAndFocusInstructionsEnd(runtime, 10_000);
  if (current === null) {
    throw new Error("Could not find the project instructions textarea to append to.");
  }
  const fresh = lines.filter((line) => !current.includes(line));
  if (fresh.length === 0) {
    logger("[voice] All dictionary entries are already present; nothing to append.");
    await closeSettingsDialog(runtime);
    return false;
  }
  const needsHeader = !current.includes(PROJECT_DICTIONARY_HEADER);
  const addition =
    (current.length === 0 || current.endsWith("\n") ? "" : "\n") +
    (needsHeader ? `\n${PROJECT_DICTIONARY_HEADER}\n${PROJECT_DICTIONARY_INTRO}\n` : "") +
    fresh.join("\n");
  await input.insertText({ text: addition });
  await delay(300);
  const committed = await runtime.evaluate({
    expression: `(() => {
      const ta = document.querySelector('[role="dialog"] textarea, dialog textarea');
      if (!ta) return false;
      ta.blur();
      return ta.value.includes(${JSON.stringify(fresh[0])});
    })()`,
    returnByValue: true,
  });
  if (committed.result?.value !== true) {
    throw new Error("Appended dictionary entries did not stick in the settings textarea.");
  }
  // Same trap as setProjectInstructions: only the dirty-state "Save" button
  // commits; closing without saving silently discards the text.
  await clickByLabel(runtime, {
    include: [...SAVE_LABELS],
    exclude: ["cancel", "キャンセル", "取消", "취소", "cancelar", "annuler", "abbrechen", "отмена", ...DELETE_WORDS],
    scope: "dialog",
    timeoutMs: 10_000,
    description: "project settings save button",
  });
  await delay(800);
  await closeSettingsDialog(runtime);
  logger(`[voice] Appended ${fresh.length} dictionary entr${fresh.length === 1 ? "y" : "ies"} to the project instructions.`);
  return true;
}

/**
 * Opens Project settings and returns the current Instructions text.
 */
export async function readProjectInstructions(
  runtime: ChromeClient["Runtime"],
  logger: BrowserLogger,
): Promise<string> {
  logger("[voice] Opening project settings to read instructions...");
  await clickByLabel(runtime, {
    include: [...PROJECT_DETAILS_LABELS],
    exclude: [],
    timeoutMs: 15_000,
    description: "project details menu button",
  });
  await clickByLabel(runtime, {
    include: [...PROJECT_SETTINGS_LABELS],
    exclude: [],
    timeoutMs: 10_000,
    description: "project settings menu item",
  });
  const current = await readAndFocusInstructionsEnd(runtime, 10_000);
  if (current === null) {
    throw new Error("Could not find the project instructions textarea to read.");
  }
  await closeSettingsDialog(runtime);
  await delay(500);
  return current;
}

async function closeSettingsDialog(runtime: ChromeClient["Runtime"]): Promise<void> {
  await clickByLabel(runtime, {
    include: [...CLOSE_LABELS],
    exclude: [...DELETE_WORDS],
    scope: "dialog",
    timeoutMs: 3_000,
    description: "project settings close button",
  }).catch(() => undefined);
}

/**
 * Reads the Instructions textarea value and leaves the caret at the END so a
 * subsequent Input.insertText appends instead of replacing.
 */
async function readAndFocusInstructionsEnd(
  runtime: ChromeClient["Runtime"],
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: `(() => {
        const ta = document.querySelector('[role="dialog"] textarea, dialog textarea');
        if (!(ta instanceof HTMLTextAreaElement)) return null;
        ta.focus();
        const end = ta.value.length;
        ta.setSelectionRange(end, end);
        if (document.activeElement !== ta) return null;
        return { value: ta.value };
      })()`,
      returnByValue: true,
    });
    const value = result.result?.value as { value: string } | null | undefined;
    if (value && typeof value.value === "string") {
      return value.value;
    }
    await delay(300);
  }
  return null;
}

async function focusDialogTextarea(
  runtime: ChromeClient["Runtime"],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: `(() => {
        const ta = document.querySelector('[role="dialog"] textarea, dialog textarea');
        if (!(ta instanceof HTMLTextAreaElement)) return false;
        ta.focus();
        ta.select();
        return document.activeElement === ta;
      })()`,
      returnByValue: true,
    });
    if (result.result?.value === true) {
      return true;
    }
    await delay(300);
  }
  return false;
}

/**
 * Clicks a project row in the sidebar by name (project rows are not anchors
 * in the current UI) and waits for the project page to open.
 */
export async function openSidebarProjectByName(
  runtime: ChromeClient["Runtime"],
  projectName: string,
  logger: BrowserLogger,
): Promise<string | null> {
  const result = await runtime.evaluate({
    expression: `(() => {
      ${SHARED_DOM_HELPERS}
      const name = ${JSON.stringify(projectName.toLowerCase().replace(/\s+/g, " ").trim())};
      const homeLabels = ${JSON.stringify([...OPEN_PROJECT_HOME_LABELS])};
      const isHomeButton = (el) => {
        const label = String(el.getAttribute('aria-label') || '').toLowerCase().trim();
        return homeLabels.some((known) => label === known || label.includes(known));
      };
      const buttons = visibleElements('button[aria-label], [role="button"][aria-label]').filter(isHomeButton);
      for (const button of buttons) {
        const row = button.closest('li, [role="listitem"], div');
        const rowText = String(row?.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        if (rowText.includes(name)) {
          click(button);
          return true;
        }
      }
      // Locale not in the dictionary: fall back to clicking the sidebar row
      // whose text is exactly the project name.
      const rows = visibleElements('nav a, nav [role="button"], nav div[tabindex], nav li div');
      for (const row of rows) {
        const rowText = String(row.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        if (rowText === name) {
          click(row);
          return true;
        }
      }
      return false;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.value !== true) {
    return null;
  }
  try {
    const url = await waitForProjectLocation(runtime, 10_000);
    logger(`[voice] Opened project "${projectName}" from the sidebar.`);
    return url;
  } catch {
    return null;
  }
}

const SHARED_DOM_HELPERS = `
  const isVisible = (element) => {
    if (!element || !(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const visibleElements = (selector) =>
    Array.from(document.querySelectorAll(selector)).filter(
      (element) => element instanceof HTMLElement && isVisible(element),
    );
  const labelFor = (element) =>
    String([
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.textContent,
    ].filter(Boolean).join(' ')).replace(/\\s+/g, ' ').trim().toLowerCase();
  const click = (element) => {
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0,
    };
    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    element.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, buttons: 1 }));
    if (typeof PointerEvent === 'function') {
      element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));
  };
`;

async function clickByLabel(
  runtime: ChromeClient["Runtime"],
  options: {
    include: string[];
    exclude: string[];
    scope?: "dialog" | "page";
    timeoutMs: number;
    description: string;
  },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  let lastCandidates: string[] = [];
  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: `(() => {
        ${SHARED_DOM_HELPERS}
        const include = ${JSON.stringify(options.include)};
        const exclude = ${JSON.stringify(options.exclude)};
        const scope = ${JSON.stringify(options.scope ?? "page")};
        const selector = scope === 'dialog'
          ? '[role="dialog"] button, [role="dialog"] [role="button"], dialog button'
          : 'button, [role="button"], [role="menuitem"], a[href]';
        const candidates = visibleElements(selector)
          .map((element) => ({ element, label: labelFor(element) }))
          .filter(({ label }) => label);
        const match = candidates.find(({ label }) =>
          include.some((token) => label.includes(token)) &&
          !exclude.some((token) => label.includes(token))
        );
        if (match) {
          click(match.element);
          return { clicked: true, label: match.label };
        }
        return { clicked: false, candidates: candidates.slice(0, 20).map(({ label }) => label.slice(0, 60)) };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = result.result?.value as
      | { clicked: true; label: string }
      | { clicked: false; candidates: string[] }
      | undefined;
    if (value?.clicked) {
      return;
    }
    lastCandidates = value?.candidates ?? [];
    await delay(400);
  }
  throw new Error(
    `Could not find ${options.description}. Visible controls: ${lastCandidates.join(" | ")}`,
  );
}

async function fillVisibleField(
  runtime: ChromeClient["Runtime"],
  value: string,
  options: {
    scope: "dialog" | "page";
    preferTextarea?: boolean;
    timeoutMs: number;
    description: string;
  },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: `(() => {
        ${SHARED_DOM_HELPERS}
        const scope = ${JSON.stringify(options.scope)};
        const preferTextarea = ${JSON.stringify(Boolean(options.preferTextarea))};
        const value = ${JSON.stringify(value)};
        const roots = scope === 'dialog'
          ? visibleElements('[role="dialog"], dialog')
          : [document.body];
        for (const root of roots) {
          const fields = Array.from(root.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]'))
            .filter((element) => element instanceof HTMLElement && isVisible(element));
          fields.sort((a, b) => {
            const rank = (el) => (el instanceof HTMLTextAreaElement ? 0 : el.isContentEditable ? 1 : 2);
            return preferTextarea ? rank(a) - rank(b) : 0;
          });
          const field = fields[0];
          if (!field) continue;
          field.focus();
          if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
            const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(field, value); else field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(field);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('insertText', false, value);
          }
          return { filled: true };
        }
        return { filled: false };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const filled = (result.result?.value as { filled?: boolean } | undefined)?.filled === true;
    if (filled) {
      return;
    }
    await delay(400);
  }
  throw new Error(`Could not find ${options.description} to fill.`);
}

async function waitForProjectLocation(
  runtime: ChromeClient["Runtime"],
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runtime.evaluate({
      expression: `(() => {
        const match = location.pathname.match(/\\/g\\/g-p-[^/?#]+/);
        return match ? match[0] + '/project' : null;
      })()`,
      returnByValue: true,
    });
    const value = result.result?.value;
    if (typeof value === "string" && value) {
      return new URL(value, CHATGPT_URL).toString();
    }
    await delay(400);
  }
  throw new Error("Timed out waiting for the new ChatGPT project page to open.");
}
