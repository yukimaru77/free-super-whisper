import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  extractChatGptConversationIdFromUrl,
  resolvePriorConversationProfileFromSessions,
  type ConversationProfileSession,
} from "../../src/browser/conversationProfile.js";

describe("conversationProfile", () => {
  test("extracts ChatGPT conversation ids only from conversation URLs", () => {
    expect(
      extractChatGptConversationIdFromUrl(
        "https://chatgpt.com/c/6a3e4ca3-7350-83ee-805f-4d717981bcd7?model=gpt-5",
      ),
    ).toBe("6a3e4ca3-7350-83ee-805f-4d717981bcd7");
    expect(extractChatGptConversationIdFromUrl("https://chat.openai.com/c/abc-123")).toBe(
      "abc-123",
    );
    expect(extractChatGptConversationIdFromUrl("https://chatgpt.com/")).toBeNull();
    expect(extractChatGptConversationIdFromUrl("https://example.com/c/abc-123")).toBeNull();
  });

  test("reuses the profile from a prior session whose original browser URL matches", () => {
    const profileA = path.resolve("/tmp/oracle-account-a");
    const profileB = path.resolve("/tmp/oracle-account-b");
    const sessions: ConversationProfileSession[] = [
      {
        id: "newer-unrelated",
        browser: {
          runtime: {
            userDataDir: profileA,
            conversationId: "other-conversation",
          },
        },
      },
      {
        id: "prior-url-match",
        browser: {
          runtime: {
            userDataDir: profileB,
          },
          config: {
            url: "https://chatgpt.com/c/original-shared-thread",
          },
        },
        options: {
          browserConfig: {
            url: "https://chatgpt.com/c/original-shared-thread",
          },
        },
      },
    ];

    expect(
      resolvePriorConversationProfileFromSessions(
        "https://chatgpt.com/c/original-shared-thread",
        [profileA, profileB],
        sessions,
      ),
    ).toEqual({
      profileDir: profileB,
      sessionId: "prior-url-match",
      requestedConversationId: "original-shared-thread",
      matchSource: "browser.config.url",
    });
  });

  test("reuses requested URL history even when that session later opened another conversation", () => {
    const profileA = path.resolve("/tmp/oracle-account-a");
    const sessions: ConversationProfileSession[] = [
      {
        id: "diverged-request-match",
        status: "completed",
        browser: {
          runtime: {
            userDataDir: profileA,
            conversationId: "different-conversation",
            tabUrl: "https://chatgpt.com/c/different-conversation",
          },
          config: {
            url: "https://chatgpt.com/c/original-conversation",
          },
        },
      },
    ];

    expect(
      resolvePriorConversationProfileFromSessions(
        "https://chatgpt.com/c/original-conversation",
        [profileA],
        sessions,
      ),
    ).toEqual({
      profileDir: profileA,
      sessionId: "diverged-request-match",
      requestedConversationId: "original-conversation",
      matchSource: "browser.config.url",
    });
  });

  test("reuses the profile from a prior session whose runtime conversation id matches", () => {
    const profileA = path.resolve("/tmp/oracle-account-a");
    const profileB = path.resolve("/tmp/oracle-account-b");
    const sessions: ConversationProfileSession[] = [
      {
        id: "prior-runtime-match",
        browser: {
          runtime: {
            userDataDir: profileB,
            conversationId: "6a3e94f2-c4e8-83e8-871f-5270ce5c3016",
          },
        },
      },
    ];

    expect(
      resolvePriorConversationProfileFromSessions(
        "https://chatgpt.com/c/6a3e94f2-c4e8-83e8-871f-5270ce5c3016",
        [profileA, profileB],
        sessions,
      )?.profileDir,
    ).toBe(profileB);
  });

  test("prefers requested URL history over actual opened conversation matches", () => {
    const profileA = path.resolve("/tmp/oracle-account-a");
    const profileB = path.resolve("/tmp/oracle-account-b");
    const sessions: ConversationProfileSession[] = [
      {
        id: "newer-request-only-match",
        createdAt: "2026-06-26T17:00:00.000Z",
        browser: {
          runtime: {
            userDataDir: profileB,
            conversationId: "new-conversation-created-in-wrong-profile",
          },
          config: {
            url: "https://chatgpt.com/c/original-conversation",
          },
        },
      },
      {
        id: "older-actual-match",
        createdAt: "2026-06-26T16:00:00.000Z",
        browser: {
          runtime: {
            userDataDir: profileA,
            conversationId: "original-conversation",
            tabUrl: "https://chatgpt.com/c/original-conversation",
          },
        },
      },
    ];

    expect(
      resolvePriorConversationProfileFromSessions(
        "https://chatgpt.com/c/original-conversation",
        [profileA, profileB],
        sessions,
      ),
    ).toEqual({
      profileDir: profileB,
      sessionId: "newer-request-only-match",
      requestedConversationId: "original-conversation",
      matchSource: "browser.config.url",
    });
  });

  test("prefers completed matches over newer running matches", () => {
    const profileA = path.resolve("/tmp/oracle-account-a");
    const profileB = path.resolve("/tmp/oracle-account-b");
    const sessions: ConversationProfileSession[] = [
      {
        id: "newer-running-match",
        createdAt: "2026-06-26T17:00:00.000Z",
        status: "running",
        browser: {
          runtime: {
            userDataDir: profileB,
            conversationId: "target-conversation",
          },
        },
      },
      {
        id: "older-completed-match",
        createdAt: "2026-06-26T16:00:00.000Z",
        status: "completed",
        browser: {
          runtime: {
            userDataDir: profileA,
            conversationId: "target-conversation",
          },
        },
      },
    ];

    expect(
      resolvePriorConversationProfileFromSessions(
        "https://chatgpt.com/c/target-conversation",
        [profileA, profileB],
        sessions,
      ),
    ).toEqual({
      profileDir: profileA,
      sessionId: "older-completed-match",
      requestedConversationId: "target-conversation",
      matchSource: "browser.runtime.conversationId",
    });
  });

  test("ignores sessions whose profile is not in the configured pool", () => {
    const profileA = path.resolve("/tmp/oracle-account-a");
    const outsideProfile = path.resolve("/tmp/outside-profile");
    const sessions: ConversationProfileSession[] = [
      {
        id: "outside-profile-match",
        browser: {
          runtime: {
            userDataDir: outsideProfile,
            conversationId: "target-conversation",
          },
        },
      },
    ];

    expect(
      resolvePriorConversationProfileFromSessions(
        "https://chatgpt.com/c/target-conversation",
        [profileA],
        sessions,
      ),
    ).toBeNull();
  });

  test("falls back to pool routing for non-conversation URLs", () => {
    expect(
      resolvePriorConversationProfileFromSessions("https://chatgpt.com/", ["/tmp/profile"], []),
    ).toBeNull();
  });
});
