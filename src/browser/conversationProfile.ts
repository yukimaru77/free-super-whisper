import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sessionStore } from "../sessionStore.js";

type BrowserConfigLike = {
  chatgptUrl?: string | null;
  url?: string | null;
};

export type ConversationProfileSession = {
  id?: string;
  createdAt?: string | null;
  status?: string | null;
  browser?: {
    runtime?: {
      userDataDir?: string | null;
      tabUrl?: string | null;
      conversationId?: string | null;
    };
    harvest?: {
      url?: string | null;
      conversationId?: string | null;
    } | null;
    config?: BrowserConfigLike;
  };
  options?: {
    browserConfig?: BrowserConfigLike;
    browserResumeConversationUrl?: string | null;
  };
};

const SESSION_METADATA_FILENAME = "meta.json";

type ConversationMatchSource =
  | "browser.runtime.conversationId"
  | "browser.runtime.tabUrl"
  | "browser.harvest.conversationId"
  | "browser.harvest.url"
  | "browser.config.chatgptUrl"
  | "browser.config.url"
  | "options.browserConfig.chatgptUrl"
  | "options.browserConfig.url"
  | "options.browserResumeConversationUrl";

const CONVERSATION_MATCH_PRIORITY: Record<ConversationMatchSource, number> = {
  "browser.config.chatgptUrl": 0,
  "browser.config.url": 0,
  "options.browserConfig.chatgptUrl": 0,
  "options.browserConfig.url": 0,
  "options.browserResumeConversationUrl": 0,
  "browser.runtime.conversationId": 1,
  "browser.runtime.tabUrl": 1,
  "browser.harvest.conversationId": 1,
  "browser.harvest.url": 1,
};

export type PriorConversationProfileResolution = {
  profileDir: string;
  sessionId: string;
  requestedConversationId: string;
  matchSource: ConversationMatchSource;
};

function normalizeProfileDir(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

function profileKey(profileDir: string): string {
  const resolved = path.resolve(profileDir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isChatGptHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "chatgpt.com" || normalized === "chat.openai.com";
}

export function extractChatGptConversationIdFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!isChatGptHost(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const conversationSegment = parts.findIndex((part) => part === "c");
    const conversationId = conversationSegment >= 0 ? parts[conversationSegment + 1] : undefined;
    return conversationId ? decodeURIComponent(conversationId) : null;
  } catch {
    const match = trimmed.match(/^https?:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\/([^/?#]+)/i);
    return match?.[1] ?? null;
  }
}

function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function collectConversationMatches(
  session: ConversationProfileSession,
): Array<{ source: ConversationMatchSource; conversationId: string }> {
  const runtime = session.browser?.runtime;
  const harvest = session.browser?.harvest;
  const browserConfig = session.browser?.config;
  const optionConfig = session.options?.browserConfig;
  const actualCandidates: Array<{
    source: ConversationMatchSource;
    value: unknown;
    isUrl?: boolean;
  }> = [
    { source: "browser.runtime.conversationId", value: runtime?.conversationId },
    { source: "browser.runtime.tabUrl", value: runtime?.tabUrl, isUrl: true },
    { source: "browser.harvest.conversationId", value: harvest?.conversationId },
    { source: "browser.harvest.url", value: harvest?.url, isUrl: true },
  ];
  const requestedCandidates: Array<{
    source: ConversationMatchSource;
    value: unknown;
    isUrl?: boolean;
  }> = [
    { source: "browser.config.chatgptUrl", value: browserConfig?.chatgptUrl, isUrl: true },
    { source: "browser.config.url", value: browserConfig?.url, isUrl: true },
    { source: "options.browserConfig.chatgptUrl", value: optionConfig?.chatgptUrl, isUrl: true },
    { source: "options.browserConfig.url", value: optionConfig?.url, isUrl: true },
    {
      source: "options.browserResumeConversationUrl",
      value: session.options?.browserResumeConversationUrl,
      isUrl: true,
    },
  ];

  const collect = (
    candidates: Array<{ source: ConversationMatchSource; value: unknown; isUrl?: boolean }>,
  ) => {
    const matches: Array<{ source: ConversationMatchSource; conversationId: string }> = [];
    for (const candidate of candidates) {
      const conversationId = candidate.isUrl
        ? extractChatGptConversationIdFromUrl(candidate.value)
        : normalizeConversationId(candidate.value);
      if (conversationId) {
        matches.push({ source: candidate.source, conversationId: conversationId.toLowerCase() });
      }
    }
    return matches;
  };

  return [...collect(requestedCandidates), ...collect(actualCandidates)];
}

export function resolvePriorConversationProfileFromSessions(
  conversationUrl: string | null | undefined,
  profileDirs: readonly string[],
  sessions: readonly ConversationProfileSession[],
): PriorConversationProfileResolution | null {
  const requestedConversationId = extractChatGptConversationIdFromUrl(conversationUrl);
  if (!requestedConversationId) return null;

  const allowedProfiles = new Map<string, string>();
  for (const profileDir of profileDirs) {
    const normalized = normalizeProfileDir(profileDir);
    if (normalized) {
      allowedProfiles.set(profileKey(normalized), normalized);
    }
  }
  if (allowedProfiles.size === 0) return null;

  const requestedKey = requestedConversationId.toLowerCase();
  let bestMatch: {
    resolution: PriorConversationProfileResolution;
    priority: number;
    statusPriority: number;
    createdAtMs: number;
  } | null = null;
  for (const session of sessions) {
    const runtimeProfile = normalizeProfileDir(session.browser?.runtime?.userDataDir);
    if (!runtimeProfile) continue;
    const allowedProfile = allowedProfiles.get(profileKey(runtimeProfile));
    if (!allowedProfile) continue;

    const match = collectConversationMatches(session).find(
      (candidate) => candidate.conversationId === requestedKey,
    );
    if (!match) continue;

    const priority = CONVERSATION_MATCH_PRIORITY[match.source];
    const statusPriority = sessionStatusPriority(session);
    const createdAtMs = sessionCreatedAtMs(session);
    if (
      bestMatch &&
      (priority > bestMatch.priority ||
        (priority === bestMatch.priority && statusPriority > bestMatch.statusPriority) ||
        (priority === bestMatch.priority &&
          statusPriority === bestMatch.statusPriority &&
          createdAtMs <= bestMatch.createdAtMs))
    ) {
      continue;
    }

    bestMatch = {
      priority,
      statusPriority,
      createdAtMs,
      resolution: {
        profileDir: allowedProfile,
        sessionId: session.id ?? "unknown",
        requestedConversationId,
        matchSource: match.source,
      },
    };
  }

  return bestMatch?.resolution ?? null;
}

function sessionStatusPriority(session: ConversationProfileSession): number {
  return session.status === "completed" ? 0 : 1;
}

function sessionCreatedAtMs(session: ConversationProfileSession): number {
  if (typeof session.createdAt !== "string") return 0;
  const timestamp = new Date(session.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function listRawConversationProfileSessions(): Promise<ConversationProfileSession[]> {
  const sessionsDir = sessionStore.sessionsDir();
  const entries = await readdir(sessionsDir).catch(() => []);
  const sessions = await Promise.all(
    entries.map(async (entry) => {
      try {
        const raw = await readFile(
          path.join(sessionsDir, entry, SESSION_METADATA_FILENAME),
          "utf8",
        );
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" ? (parsed as ConversationProfileSession) : null;
      } catch {
        return null;
      }
    }),
  );
  return sessions
    .filter((session): session is ConversationProfileSession => Boolean(session))
    .sort((a, b) => sessionCreatedAtMs(b) - sessionCreatedAtMs(a));
}

export async function resolvePriorConversationProfile(
  conversationUrl: string | null | undefined,
  profileDirs: readonly string[],
): Promise<PriorConversationProfileResolution | null> {
  if (!extractChatGptConversationIdFromUrl(conversationUrl)) return null;
  const sessions = await listRawConversationProfileSessions().catch(() => []);
  return resolvePriorConversationProfileFromSessions(conversationUrl, profileDirs, sessions);
}
