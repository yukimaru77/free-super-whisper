import { describe, expect, test, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import {
  acquireBrowserTabLease,
  acquireBrowserTabLeaseFromPool,
  hasOtherActiveBrowserTabLeases,
  normalizeMaxConcurrentTabs,
} from "../../src/browser/tabLeaseRegistry.js";

describe("tabLeaseRegistry", () => {
  test("normalizes the concurrent tab limit", () => {
    expect(normalizeMaxConcurrentTabs(undefined)).toBe(3);
    expect(normalizeMaxConcurrentTabs("4")).toBe(4);
    expect(normalizeMaxConcurrentTabs(0)).toBe(3);
    expect(normalizeMaxConcurrentTabs("nope")).toBe(3);
  });

  test("queues when the max concurrent tab limit is reached", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oracle-tab-leases-"));
    try {
      const logger = vi.fn();
      const first = await acquireBrowserTabLease(dir, {
        maxConcurrentTabs: 3,
        pollMs: 25,
        timeoutMs: 500,
        logger,
      });
      const second = await acquireBrowserTabLease(dir, {
        maxConcurrentTabs: 3,
        pollMs: 25,
        timeoutMs: 500,
        logger,
      });
      const third = await acquireBrowserTabLease(dir, {
        maxConcurrentTabs: 3,
        pollMs: 25,
        timeoutMs: 500,
        logger,
      });
      let resolved = false;
      const fourthPromise = acquireBrowserTabLease(dir, {
        maxConcurrentTabs: 3,
        pollMs: 25,
        timeoutMs: 1000,
        logger,
      }).then((lease) => {
        resolved = true;
        return lease;
      });

      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(resolved).toBe(false);
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining("Waiting for ChatGPT browser slot"),
      );

      await first.release();
      const fourth = await fourthPromise;
      expect(resolved).toBe(true);

      await second.release();
      await third.release();
      await fourth.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("drops stale leases owned by dead pids", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oracle-tab-leases-"));
    try {
      const stale = await acquireBrowserTabLease(
        dir,
        { maxConcurrentTabs: 1, timeoutMs: 500, sessionId: "stale-session" },
        { pid: 123_456, isProcessAlive: () => true },
      );
      await stale.update({ chromeTargetId: "target-stale" });

      const fresh = await acquireBrowserTabLease(
        dir,
        { maxConcurrentTabs: 1, timeoutMs: 500, sessionId: "fresh-session" },
        { isProcessAlive: (pid) => pid !== 123_456 },
      );
      await fresh.update({ chromeTargetId: "target-fresh", tabUrl: "https://chatgpt.com/c/1" });

      const registry = JSON.parse(
        await readFile(path.join(dir, "oracle-tab-leases.json"), "utf8"),
      ) as { leases: Array<{ sessionId?: string; chromeTargetId?: string; tabUrl?: string }> };
      expect(registry.leases).toHaveLength(1);
      expect(registry.leases[0]).toMatchObject({
        sessionId: "fresh-session",
        chromeTargetId: "target-fresh",
        tabUrl: "https://chatgpt.com/c/1",
      });

      await fresh.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("detects other active leases before releasing a shared Chrome owner", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "oracle-tab-leases-"));
    try {
      const first = await acquireBrowserTabLease(dir, {
        maxConcurrentTabs: 3,
        timeoutMs: 500,
        sessionId: "first-session",
      });
      const second = await acquireBrowserTabLease(dir, {
        maxConcurrentTabs: 3,
        timeoutMs: 500,
        sessionId: "second-session",
      });

      expect(await hasOtherActiveBrowserTabLeases(dir, first.id)).toBe(true);

      await second.release();
      expect(await hasOtherActiveBrowserTabLeases(dir, first.id)).toBe(false);

      await first.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("routes leases across a profile pool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oracle-tab-lease-pool-"));
    const firstProfile = path.join(root, "account-a");
    const secondProfile = path.join(root, "account-b");
    try {
      const first = await acquireBrowserTabLeaseFromPool([firstProfile, secondProfile], {
        maxConcurrentTabs: 2,
        timeoutMs: 500,
      });
      const second = await acquireBrowserTabLeaseFromPool([firstProfile, secondProfile], {
        maxConcurrentTabs: 2,
        timeoutMs: 500,
      });
      const third = await acquireBrowserTabLeaseFromPool([firstProfile, secondProfile], {
        maxConcurrentTabs: 2,
        timeoutMs: 500,
      });
      const fourth = await acquireBrowserTabLeaseFromPool([firstProfile, secondProfile], {
        maxConcurrentTabs: 2,
        timeoutMs: 500,
      });

      expect([first.profileDir, second.profileDir, third.profileDir, fourth.profileDir]).toEqual([
        firstProfile,
        secondProfile,
        firstProfile,
        secondProfile,
      ]);

      await first.release();
      await second.release();
      await third.release();
      await fourth.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prefers the least-loaded profile in a pool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oracle-tab-lease-pool-"));
    const firstProfile = path.join(root, "account-a");
    const secondProfile = path.join(root, "account-b");
    try {
      await mkdir(firstProfile, { recursive: true });
      await mkdir(secondProfile, { recursive: true });

      const firstProfileLoad = await acquireBrowserTabLease(firstProfile, {
        maxConcurrentTabs: 3,
        timeoutMs: 500,
      });
      const secondFirstProfileLoad = await acquireBrowserTabLease(firstProfile, {
        maxConcurrentTabs: 3,
        timeoutMs: 500,
      });

      const pooled = await acquireBrowserTabLeaseFromPool([firstProfile, secondProfile], {
        maxConcurrentTabs: 3,
        timeoutMs: 500,
      });

      expect(pooled.profileDir).toBe(secondProfile);

      await firstProfileLoad.release();
      await secondFirstProfileLoad.release();
      await pooled.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
