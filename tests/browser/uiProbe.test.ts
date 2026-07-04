import { describe, expect, test, vi } from "vitest";
import {
  UI_PROBE_TARGETS,
  buildUiProbeExpression,
  formatUiProbeReport,
  missingUiProbeTargets,
  probeChatGptUi,
  warnOnUnexpectedChatGptUi,
  type UiProbeResult,
} from "../../src/browser/uiProbe.ts";
import { INPUT_SELECTORS, SEND_BUTTON_SELECTORS } from "../../src/browser/constants.ts";
import type { BrowserLogger } from "../../src/browser/types.ts";

const sampleProbe = (overrides: Partial<Record<string, boolean>> = {}): UiProbeResult => ({
  url: "https://chatgpt.com/",
  title: "ChatGPT",
  readyState: "complete",
  targets: UI_PROBE_TARGETS.map((target) => {
    const matched = overrides[target.name] ?? true;
    return {
      name: target.name,
      matchedSelector: matched ? target.selectors[0] : null,
      count: matched ? 1 : 0,
    };
  }),
});

describe("UI_PROBE_TARGETS", () => {
  test("target names are unique and selectors are non-empty", () => {
    const names = UI_PROBE_TARGETS.map((target) => target.name);
    expect(new Set(names).size).toBe(names.length);
    for (const target of UI_PROBE_TARGETS) {
      expect(target.selectors.length).toBeGreaterThan(0);
      for (const selector of target.selectors) {
        expect(selector.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("covers the composer input and send button selector lists", () => {
    const composer = UI_PROBE_TARGETS.find((target) => target.name === "composer-input");
    const send = UI_PROBE_TARGETS.find((target) => target.name === "send-button");
    expect(composer?.selectors).toEqual(INPUT_SELECTORS);
    expect(send?.selectors).toEqual(SEND_BUTTON_SELECTORS);
  });
});

describe("buildUiProbeExpression", () => {
  test("embeds every probe target name and selector", () => {
    const expression = buildUiProbeExpression();
    for (const target of UI_PROBE_TARGETS) {
      expect(expression).toContain(JSON.stringify(target.name));
    }
    expect(expression).toContain(JSON.stringify(INPUT_SELECTORS[0]).slice(1, -1));
  });
});

describe("probeChatGptUi", () => {
  test("normalizes evaluate results and tolerates malformed entries", async () => {
    const runtime = {
      evaluate: vi.fn().mockResolvedValue({
        result: {
          value: {
            url: "https://chatgpt.com/c/abc",
            title: "ChatGPT",
            readyState: "complete",
            targets: [
              { name: "composer-input", matchedSelector: "#prompt-textarea", count: 1 },
              { name: "send-button", matchedSelector: null, count: 0 },
              "garbage",
              { matchedSelector: "orphan" },
            ],
          },
        },
      }),
    };
    const probe = await probeChatGptUi(runtime as never);
    expect(probe?.targets).toEqual([
      { name: "composer-input", matchedSelector: "#prompt-textarea", count: 1 },
      { name: "send-button", matchedSelector: null, count: 0 },
    ]);
  });

  test("returns null when the page yields no probe payload", async () => {
    const runtime = { evaluate: vi.fn().mockResolvedValue({ result: { value: null } }) };
    expect(await probeChatGptUi(runtime as never)).toBeNull();
  });
});

describe("missingUiProbeTargets", () => {
  test("reports only expected-phase targets that did not match", () => {
    const probe = sampleProbe({ "composer-input": false, "stop-button": false });
    expect(missingUiProbeTargets(probe, "composer")).toEqual(["composer-input"]);
    expect(missingUiProbeTargets(probe, "conversation")).toEqual([]);
  });
});

describe("formatUiProbeReport", () => {
  test("renders one status token per target", () => {
    const report = formatUiProbeReport(sampleProbe({ "send-button": false }));
    expect(report).toContain("[ui-probe]");
    expect(report).toContain("send-button=missing");
    expect(report).toContain("composer-input=ok(1)");
  });
});

describe("warnOnUnexpectedChatGptUi", () => {
  const runtimeFor = (probe: UiProbeResult) => ({
    evaluate: vi.fn().mockResolvedValue({
      result: { value: probe },
    }),
  });

  test("warns loudly when an expected composer element is missing", async () => {
    const logger = vi.fn() as BrowserLogger;
    await warnOnUnexpectedChatGptUi(
      runtimeFor(sampleProbe({ "model-switcher": false })) as never,
      logger,
      "composer",
      "prompt-ready",
    );
    const messages = (logger as ReturnType<typeof vi.fn>).mock.calls.map(([m]) => m);
    expect(messages.some((m: string) => m.includes("ChatGPT UI may have changed"))).toBe(true);
    expect(messages.some((m: string) => m.includes("model-switcher"))).toBe(true);
  });

  test("stays quiet (non-verbose) when everything matches", async () => {
    const logger = vi.fn() as BrowserLogger;
    await warnOnUnexpectedChatGptUi(
      runtimeFor(sampleProbe()) as never,
      logger,
      "composer",
      "prompt-ready",
    );
    expect(logger).not.toHaveBeenCalled();
  });

  test("never throws when the probe itself fails", async () => {
    const runtime = { evaluate: vi.fn().mockRejectedValue(new Error("detached")) };
    const logger = vi.fn() as BrowserLogger;
    await expect(
      warnOnUnexpectedChatGptUi(runtime as never, logger, "composer", "prompt-ready"),
    ).resolves.toBeNull();
  });
});
