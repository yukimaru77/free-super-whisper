import { mkdir } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { resolveBrowserConfig } from "../browser/config.js";
import { CHATGPT_URL } from "../browser/constants.js";
import { connectWithNewTab } from "../browser/chromeLifecycle.js";
import { defaultManualLoginProfileDir } from "../browser/manualLoginProfile.js";
import {
  installJavaScriptDialogAutoDismissal,
  navigateToChatGPT,
} from "../browser/pageActions.js";
import { writeChromePid, writeDevToolsActivePort } from "../browser/profileState.js";
import type { BrowserLogger } from "../browser/types.js";
import {
  acquireManualLoginChromeForVoice,
  waitForVoiceLogin,
} from "../browser/voiceInputRunner.js";
import { parseDuration } from "../duration.js";

export interface LoginCliOptions {
  profileDir?: string;
  chatgptUrl?: string;
  timeout?: string;
  verbose?: boolean;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 600_000; // 10 minutes to complete the sign-in

/**
 * First-run setup: opens Chrome with the persistent super-whisper profile on
 * chatgpt.com, waits until a logged-in session is detected, then leaves the
 * browser running so subsequent `super-whisper voice` commands can reuse it.
 */
export async function runLoginCliCommand(options: LoginCliOptions): Promise<void> {
  const logger = ((message: string) => {
    if (options.verbose || !message.startsWith("[debug]")) {
      console.log(chalk.dim(message));
    }
  }) as BrowserLogger;

  const userDataDir = path.resolve(options.profileDir ?? defaultManualLoginProfileDir());
  await mkdir(userDataDir, { recursive: true });
  const chatgptUrl = options.chatgptUrl ?? CHATGPT_URL;
  const timeoutMs = options.timeout
    ? parseDuration(options.timeout, DEFAULT_LOGIN_TIMEOUT_MS)
    : DEFAULT_LOGIN_TIMEOUT_MS;
  const config = resolveBrowserConfig({
    url: chatgptUrl,
    chatgptUrl,
    manualLogin: true,
    manualLoginProfileDir: userDataDir,
    cookieSync: false,
    keepBrowser: true,
    desiredModel: null,
    modelStrategy: "ignore",
    timeoutMs,
  });

  console.log(chalk.bold("super-whisper first-run setup"));
  console.log(`Chrome profile: ${userDataDir}`);

  const { chrome, reusedChrome } = await acquireManualLoginChromeForVoice(
    userDataDir,
    config,
    logger,
  );
  let removeDialogHandler: (() => void) | null = null;
  let client: Awaited<ReturnType<typeof connectWithNewTab>>["client"] | null = null;
  try {
    if (chrome.port) {
      await writeDevToolsActivePort(userDataDir, chrome.port);
      if (!reusedChrome && chrome.pid) {
        await writeChromePid(userDataDir, chrome.pid);
      }
    }
    const chromeHost = (chrome as { host?: string }).host ?? "127.0.0.1";
    const connection = await connectWithNewTab(chrome.port, logger, "about:blank", chromeHost, {
      fallbackToDefault: false,
      retries: 6,
      retryDelayMs: 500,
    });
    client = connection.client;
    const { Page, Runtime, Network } = client;
    await Promise.all([Network.enable({}), Page.enable(), Runtime.enable()]);
    removeDialogHandler = installJavaScriptDialogAutoDismissal(Page, logger);
    await navigateToChatGPT(Page, Runtime, chatgptUrl, logger);
    console.log("");
    console.log(chalk.bold("Sign in to ChatGPT in the Chrome window that just opened."));
    console.log("Waiting for the login to complete (this command polls automatically)...");
    await waitForVoiceLogin({
      runtime: Runtime,
      logger,
      appliedCookies: 0,
      manualLogin: true,
      timeoutMs,
      profileDir: userDataDir,
    });
    console.log("");
    console.log(chalk.bold("Login detected. super-whisper is ready."));
    console.log(`Chrome stays running with the signed-in profile at ${userDataDir}.`);
    console.log(`Try it: ${chalk.cyan("super-whisper voice toggle")}`);
    try {
      chrome.process?.unref();
    } catch {
      // best effort
    }
  } finally {
    removeDialogHandler?.();
    await client?.close().catch(() => undefined);
  }
}
