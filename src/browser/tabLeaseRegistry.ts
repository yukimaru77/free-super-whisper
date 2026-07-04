import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { BrowserLogger } from "./types.js";
import { isProcessAlive } from "./profileState.js";
import { delay } from "./utils.js";

export const DEFAULT_MAX_CONCURRENT_CHATGPT_TABS = 3;
const REGISTRY_FILENAME = "oracle-tab-leases.json";
const REGISTRY_LOCK_DIRNAME = "oracle-tab-leases.lock";
const POOL_STATE_FILENAME = "oracle-tab-lease-pool.json";
const POOL_LOCK_DIRNAME = "oracle-tab-lease-pool.lock";
const DEFAULT_POLL_MS = 1000;
const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;
const REGISTRY_LOCK_TIMEOUT_MS = 10_000;

export interface BrowserTabLeaseRecord {
  id: string;
  pid: number;
  sessionId?: string;
  chromeHost?: string;
  chromePort?: number;
  chromeTargetId?: string;
  tabUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserTabLease {
  id: string;
  profileDir: string;
  release: () => Promise<void>;
  update: (patch: Partial<BrowserTabLeaseRecord>) => Promise<void>;
}

interface BrowserTabLeaseRegistryFile {
  version: 1;
  leases: BrowserTabLeaseRecord[];
}

interface BrowserTabLeasePoolStateFile {
  version: 1;
  lastProfileDir?: string;
  updatedAt?: string;
}

interface BrowserTabLeaseDeps {
  now?: () => number;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

export function normalizeMaxConcurrentTabs(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_MAX_CONCURRENT_CHATGPT_TABS;
  }
  const numeric = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_MAX_CONCURRENT_CHATGPT_TABS;
  }
  return Math.max(1, Math.trunc(numeric));
}

export async function acquireBrowserTabLease(
  profileDir: string,
  options: {
    maxConcurrentTabs?: number;
    timeoutMs?: number;
    pollMs?: number;
    logger?: BrowserLogger;
    sessionId?: string;
    chromeHost?: string;
    chromePort?: number;
    staleMs?: number;
  },
  deps: BrowserTabLeaseDeps = {},
): Promise<BrowserTabLease> {
  const maxConcurrentTabs = normalizeMaxConcurrentTabs(options.maxConcurrentTabs);
  const pollMs = Math.max(50, options.pollMs ?? DEFAULT_POLL_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const staleMs = Math.max(60_000, options.staleMs ?? DEFAULT_STALE_MS);
  const now = deps.now ?? Date.now;
  const pid = deps.pid ?? process.pid;
  const leaseId = randomUUID();
  const startedAt = now();
  let warned = false;
  let lastHeartbeatAt = 0;

  for (;;) {
    const acquired = await tryAcquireBrowserTabLease(profileDir, {
      maxConcurrentTabs,
      leaseId,
      pid,
      nowMs: now(),
      staleMs,
      isProcessAlive: deps.isProcessAlive ?? isProcessAlive,
      sessionId: options.sessionId,
      chromeHost: options.chromeHost,
      chromePort: options.chromePort,
    });

    if (acquired) {
      options.logger?.(
        `[browser] Acquired ChatGPT browser slot ${leaseId.slice(0, 8)} (${maxConcurrentTabs} max, profile=${profileDir}).`,
      );
      return {
        id: leaseId,
        profileDir,
        release: async () => releaseBrowserTabLease(profileDir, leaseId, options.logger),
        update: async (patch) => updateBrowserTabLease(profileDir, leaseId, patch),
      };
    }

    const elapsed = now() - startedAt;
    if (!warned || now() - lastHeartbeatAt >= 30_000) {
      options.logger?.(
        `[browser] Waiting for ChatGPT browser slot (${maxConcurrentTabs} max, ${Math.round(elapsed / 1000)}s elapsed).`,
      );
      warned = true;
      lastHeartbeatAt = now();
    }
    if (timeoutMs > 0 && elapsed >= timeoutMs) {
      throw new Error(
        `Timed out waiting for ChatGPT browser slot after ${Math.round(elapsed / 1000)}s (${maxConcurrentTabs} max).`,
      );
    }
    await delay(timeoutMs > 0 ? Math.min(pollMs, timeoutMs - elapsed) : pollMs);
  }
}

export async function acquireBrowserTabLeaseFromPool(
  profileDirs: readonly string[],
  options: {
    maxConcurrentTabs?: number;
    timeoutMs?: number;
    pollMs?: number;
    logger?: BrowserLogger;
    sessionId?: string;
    chromeHost?: string;
    chromePort?: number;
    staleMs?: number;
  },
  deps: BrowserTabLeaseDeps = {},
): Promise<BrowserTabLease> {
  const dirs = Array.from(new Set(profileDirs.map((dir) => dir.trim()).filter(Boolean)));
  if (dirs.length === 0) {
    throw new Error("No manual-login profile directories configured.");
  }
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
  if (dirs.length === 1) {
    return acquireBrowserTabLease(dirs[0], options, deps);
  }

  const maxConcurrentTabs = normalizeMaxConcurrentTabs(options.maxConcurrentTabs);
  const pollMs = Math.max(50, options.pollMs ?? DEFAULT_POLL_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const staleMs = Math.max(60_000, options.staleMs ?? DEFAULT_STALE_MS);
  const now = deps.now ?? Date.now;
  const pid = deps.pid ?? process.pid;
  const leaseId = randomUUID();
  const startedAt = now();
  let warned = false;
  let lastHeartbeatAt = 0;

  for (;;) {
    const acquired = await tryAcquireBrowserTabLeaseFromPool(dirs, {
      maxConcurrentTabs,
      leaseId,
      pid,
      nowMs: now(),
      staleMs,
      isProcessAlive: deps.isProcessAlive ?? isProcessAlive,
      sessionId: options.sessionId,
      chromeHost: options.chromeHost,
      chromePort: options.chromePort,
    });
    if (acquired) {
      options.logger?.(
        `[browser] Acquired ChatGPT browser slot ${leaseId.slice(0, 8)} (${maxConcurrentTabs} max, profile=${acquired.profileDir}).`,
      );
      return {
        id: leaseId,
        profileDir: acquired.profileDir,
        release: async () => releaseBrowserTabLease(acquired.profileDir, leaseId, options.logger),
        update: async (patch) => updateBrowserTabLease(acquired.profileDir, leaseId, patch),
      };
    }

    const elapsed = now() - startedAt;
    if (!warned || now() - lastHeartbeatAt >= 30_000) {
      options.logger?.(
        `[browser] Waiting for ChatGPT browser slot (${maxConcurrentTabs} max per profile, ${dirs.length} profiles, ${Math.round(elapsed / 1000)}s elapsed).`,
      );
      warned = true;
      lastHeartbeatAt = now();
    }
    if (timeoutMs > 0 && elapsed >= timeoutMs) {
      throw new Error(
        `Timed out waiting for ChatGPT browser slot after ${Math.round(elapsed / 1000)}s (${maxConcurrentTabs} max per profile, ${dirs.length} profiles).`,
      );
    }
    await delay(timeoutMs > 0 ? Math.min(pollMs, timeoutMs - elapsed) : pollMs);
  }
}

async function tryAcquireBrowserTabLeaseFromPool(
  profileDirs: readonly string[],
  options: {
    maxConcurrentTabs: number;
    leaseId: string;
    pid: number;
    nowMs: number;
    staleMs: number;
    isProcessAlive: (pid: number) => boolean;
    sessionId?: string;
    chromeHost?: string;
    chromePort?: number;
  },
): Promise<{ profileDir: string; lease: BrowserTabLeaseRecord } | null> {
  return withPoolLock(profileDirs, async (poolDir) => {
    const state = await readPoolState(poolDir);
    const loads: Array<{ profileDir: string; activeCount: number; index: number }> = [];
    for (const [index, profileDir] of profileDirs.entries()) {
      const activeCount = await countActiveBrowserTabLeases(profileDir, {
        nowMs: options.nowMs,
        staleMs: options.staleMs,
        isProcessAlive: options.isProcessAlive,
      });
      if (activeCount < options.maxConcurrentTabs) {
        loads.push({ profileDir, activeCount, index });
      }
    }

    loads.sort((a, b) => {
      if (a.activeCount !== b.activeCount) {
        return a.activeCount - b.activeCount;
      }
      const aWasLast = a.profileDir === state.lastProfileDir;
      const bWasLast = b.profileDir === state.lastProfileDir;
      if (aWasLast !== bWasLast) {
        return aWasLast ? 1 : -1;
      }
      return a.index - b.index;
    });

    for (const { profileDir } of loads) {
      const lease = await tryAcquireBrowserTabLease(profileDir, options);
      if (lease) {
        await writePoolState(poolDir, {
          version: 1,
          lastProfileDir: profileDir,
          updatedAt: new Date(options.nowMs).toISOString(),
        });
        return { profileDir, lease };
      }
    }

    return null;
  });
}

async function tryAcquireBrowserTabLease(
  profileDir: string,
  options: {
    maxConcurrentTabs: number;
    leaseId: string;
    pid: number;
    nowMs: number;
    staleMs: number;
    isProcessAlive: (pid: number) => boolean;
    sessionId?: string;
    chromeHost?: string;
    chromePort?: number;
  },
): Promise<BrowserTabLeaseRecord | null> {
  return withRegistryLock(profileDir, async () => {
    const registry = await readRegistry(profileDir);
    const active = pruneStaleLeases(registry.leases, {
      nowMs: options.nowMs,
      staleMs: options.staleMs,
      isProcessAlive: options.isProcessAlive,
    });
    if (active.length >= options.maxConcurrentTabs) {
      if (active.length !== registry.leases.length) {
        await writeRegistry(profileDir, { version: 1, leases: active });
      }
      return null;
    }
    const timestamp = new Date(options.nowMs).toISOString();
    const lease: BrowserTabLeaseRecord = {
      id: options.leaseId,
      pid: options.pid,
      sessionId: options.sessionId,
      chromeHost: options.chromeHost,
      chromePort: options.chromePort,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await writeRegistry(profileDir, { version: 1, leases: [...active, lease] });
    return lease;
  });
}

async function countActiveBrowserTabLeases(
  profileDir: string,
  options: {
    nowMs: number;
    staleMs: number;
    isProcessAlive: (pid: number) => boolean;
  },
): Promise<number> {
  return withRegistryLock(profileDir, async () => {
    const registry = await readRegistry(profileDir);
    const active = pruneStaleLeases(registry.leases, options);
    if (active.length !== registry.leases.length) {
      await writeRegistry(profileDir, { version: 1, leases: active });
    }
    return active.length;
  });
}

export async function updateBrowserTabLease(
  profileDir: string,
  leaseId: string,
  patch: Partial<BrowserTabLeaseRecord>,
): Promise<void> {
  await withRegistryLock(profileDir, async () => {
    const registry = await readRegistry(profileDir);
    const leases = registry.leases.map((lease) =>
      lease.id === leaseId
        ? { ...lease, ...patch, id: lease.id, updatedAt: new Date().toISOString() }
        : lease,
    );
    await writeRegistry(profileDir, { version: 1, leases });
  });
}

export async function releaseBrowserTabLease(
  profileDir: string,
  leaseId: string,
  logger?: BrowserLogger,
): Promise<void> {
  await withRegistryLock(profileDir, async () => {
    const registry = await readRegistry(profileDir);
    const leases = registry.leases.filter((lease) => lease.id !== leaseId);
    await writeRegistry(profileDir, { version: 1, leases });
  }).catch(() => undefined);
  logger?.(`[browser] Released ChatGPT browser slot ${leaseId.slice(0, 8)}.`);
}

export async function hasOtherActiveBrowserTabLeases(
  profileDir: string,
  leaseId: string,
  options: {
    staleMs?: number;
    now?: () => number;
    isProcessAlive?: (pid: number) => boolean;
  } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const staleMs = Math.max(60_000, options.staleMs ?? DEFAULT_STALE_MS);
  return withRegistryLock(profileDir, async () => {
    const registry = await readRegistry(profileDir);
    const active = pruneStaleLeases(registry.leases, {
      nowMs: now(),
      staleMs,
      isProcessAlive: options.isProcessAlive ?? isProcessAlive,
    });
    if (active.length !== registry.leases.length) {
      await writeRegistry(profileDir, { version: 1, leases: active });
    }
    return active.some((lease) => lease.id !== leaseId);
  });
}

async function withRegistryLock<T>(profileDir: string, callback: () => Promise<T>): Promise<T> {
  const lockDir = path.join(profileDir, REGISTRY_LOCK_DIRNAME);
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir, { recursive: false });
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt > REGISTRY_LOCK_TIMEOUT_MS) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      await delay(50);
    }
  }
  try {
    return await callback();
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function withPoolLock<T>(
  profileDirs: readonly string[],
  callback: (poolDir: string) => Promise<T>,
): Promise<T> {
  const poolDir = poolStateDir(profileDirs);
  await mkdir(poolDir, { recursive: true });
  const lockDir = path.join(poolDir, POOL_LOCK_DIRNAME);
  const startedAt = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir, { recursive: false });
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt > REGISTRY_LOCK_TIMEOUT_MS) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      await delay(50);
    }
  }
  try {
    return await callback(poolDir);
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readRegistry(profileDir: string): Promise<BrowserTabLeaseRegistryFile> {
  try {
    const raw = await readFile(registryPath(profileDir), "utf8");
    const parsed = JSON.parse(raw) as BrowserTabLeaseRegistryFile;
    if (!Array.isArray(parsed.leases)) {
      return { version: 1, leases: [] };
    }
    return {
      version: 1,
      leases: parsed.leases.filter(isLeaseRecord),
    };
  } catch {
    return { version: 1, leases: [] };
  }
}

async function writeRegistry(
  profileDir: string,
  registry: BrowserTabLeaseRegistryFile,
): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  await writeFile(registryPath(profileDir), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function registryPath(profileDir: string): string {
  return path.join(profileDir, REGISTRY_FILENAME);
}

async function readPoolState(poolDir: string): Promise<BrowserTabLeasePoolStateFile> {
  try {
    const raw = await readFile(poolStatePath(poolDir), "utf8");
    const parsed = JSON.parse(raw) as BrowserTabLeasePoolStateFile;
    return {
      version: 1,
      lastProfileDir: typeof parsed.lastProfileDir === "string" ? parsed.lastProfileDir : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return { version: 1 };
  }
}

async function writePoolState(
  poolDir: string,
  state: BrowserTabLeasePoolStateFile,
): Promise<void> {
  await mkdir(poolDir, { recursive: true });
  await writeFile(poolStatePath(poolDir), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function poolStatePath(poolDir: string): string {
  return path.join(poolDir, POOL_STATE_FILENAME);
}

function poolStateDir(profileDirs: readonly string[]): string {
  return path.dirname(path.resolve(profileDirs[0] ?? "."));
}

function pruneStaleLeases(
  leases: BrowserTabLeaseRecord[],
  options: { nowMs: number; staleMs: number; isProcessAlive: (pid: number) => boolean },
): BrowserTabLeaseRecord[] {
  return leases.filter((lease) => {
    if (!options.isProcessAlive(lease.pid)) {
      return false;
    }
    const updatedAt = Date.parse(lease.updatedAt);
    if (Number.isFinite(updatedAt) && options.nowMs - updatedAt > options.staleMs) {
      return false;
    }
    return true;
  });
}

function isLeaseRecord(value: unknown): value is BrowserTabLeaseRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as BrowserTabLeaseRecord;
  return (
    typeof record.id === "string" &&
    typeof record.pid === "number" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}
