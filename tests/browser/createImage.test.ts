import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  activateCreateImageTool,
  buildActivateCreateImageExpressionForTest,
} from "../../src/browser/actions/createImage.js";
import type { BrowserLogger } from "../../src/browser/types.js";

function createMockRuntime() {
  return {
    evaluate: vi.fn(),
  };
}

function createMockLogger(): BrowserLogger {
  const fn = vi.fn() as BrowserLogger;
  fn.verbose = false;
  fn.sessionLog = vi.fn();
  return fn;
}

describe("activateCreateImageTool", () => {
  let mockRuntime: ReturnType<typeof createMockRuntime>;
  let mockLogger: BrowserLogger;

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    mockLogger = createMockLogger();
  });

  it("activates Create image when all steps succeed", async () => {
    mockRuntime.evaluate.mockResolvedValueOnce({
      result: { value: { status: "activated" } },
    });
    await expect(
      activateCreateImageTool(mockRuntime as never, mockLogger),
    ).resolves.toBeUndefined();
    expect(mockLogger).toHaveBeenCalledWith("[browser] Create image tool activated");
  });

  it("returns early when already active", async () => {
    mockRuntime.evaluate.mockResolvedValueOnce({
      result: { value: { status: "already-active" } },
    });
    await expect(
      activateCreateImageTool(mockRuntime as never, mockLogger),
    ).resolves.toBeUndefined();
    expect(mockLogger).toHaveBeenCalledWith("[browser] Create image tool already active");
  });

  it("throws when plus button is missing", async () => {
    mockRuntime.evaluate.mockResolvedValueOnce({
      result: { value: { status: "plus-button-missing" } },
    });
    await expect(activateCreateImageTool(mockRuntime as never, mockLogger)).rejects.toThrow(
      /composer plus button/,
    );
  });

  it("throws with available options when Create image item is missing", async () => {
    mockRuntime.evaluate.mockResolvedValueOnce({
      result: {
        value: {
          status: "dropdown-item-missing",
          available: ["Deep research", "Web search"],
        },
      },
    });
    await expect(activateCreateImageTool(mockRuntime as never, mockLogger)).rejects.toThrow(
      /not found.*Deep research/,
    );
  });

  it("throws when pill does not confirm", async () => {
    mockRuntime.evaluate.mockResolvedValueOnce({
      result: { value: { status: "pill-not-confirmed" } },
    });
    await expect(activateCreateImageTool(mockRuntime as never, mockLogger)).rejects.toThrow(
      /pill did not appear/,
    );
  });

  it("throws on unexpected result", async () => {
    mockRuntime.evaluate.mockResolvedValueOnce({
      result: { value: { status: "unknown-status" } },
    });
    await expect(activateCreateImageTool(mockRuntime as never, mockLogger)).rejects.toThrow(
      /Unexpected result/,
    );
  });
});

describe("Create image activation expression", () => {
  it("uses the composer tools menu and verifies the image pill", () => {
    const expression = buildActivateCreateImageExpressionForTest();

    expect(expression).toContain("Create image");
    expect(expression).toContain("composer-plus-btn");
    expect(expression).toContain('role="menuitemradio"');
    expect(expression).toContain('[data-testid="composer-footer-actions"]');
    expect(expression).toContain("click to remove");
    expect(expression).toContain("already-active");
  });
});
