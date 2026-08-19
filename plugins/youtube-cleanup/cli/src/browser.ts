import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { BrowserError } from './errors.js';
import { log } from './logger.js';

export interface AttachedBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Closes the tab this tool opened and detaches. Never closes the user's Chrome. */
  detach: () => Promise<void>;
}

/**
 * Attaches to a Chrome that the user started themselves with
 * `--remote-debugging-port`, reusing its existing signed-in profile, and opens a
 * fresh tab inside the user's own browser context.
 */
export const attach = async (cdpUrl: string): Promise<AttachedBrowser> => {
  log.step(`Attaching to Chrome at ${cdpUrl}`);

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15_000 });
  } catch (error) {
    throw new BrowserError(
      `Could not attach to Chrome at ${cdpUrl}: ${(error as Error).message}\n` +
        `  Start Chrome with remote debugging enabled first:\n` +
        `    open -na "Google Chrome" --args \\\n` +
        `      --remote-debugging-port=9222 \\\n` +
        `      --user-data-dir="$HOME/.chrome-debug-profile" \\\n` +
        `      --no-first-run --no-default-browser-check\n` +
        `  A separate --user-data-dir is required: since Chrome 136 the port is\n` +
        `  refused on the default profile directory. Then sign in to YouTube in\n` +
        `  that window once.`,
    );
  }

  const contexts = browser.contexts();
  const context = contexts[0];
  if (context === undefined) {
    await browser.close().catch(() => undefined);
    throw new BrowserError(
      `Chrome at ${cdpUrl} exposed no browser context. Open at least one tab and retry.`,
    );
  }

  const page = await context.newPage();
  log.debug(`opened a new tab in the existing context (${contexts.length} context(s) available)`);

  const detach = async (): Promise<void> => {
    await page.close().catch(() => undefined);
    // For a CDP-attached browser this disconnects the client; it does not
    // terminate the user's Chrome.
    await browser.close().catch(() => undefined);
  };

  return { browser, context, page, detach };
};
