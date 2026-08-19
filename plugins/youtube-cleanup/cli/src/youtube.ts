import type { Page } from 'playwright-core';
import { YouTubeStateError } from './errors.js';
import { log } from './logger.js';

/** Attribute used to pin an element in the page so we can address it later. */
export const MARK_ATTR = 'data-ytc-item';
const MENU_ATTR = 'data-ytc-menu-btn';

/**
 * `hl=en` (without `persist_hl`) renders this page load in English without
 * changing the account's saved language preference. It makes the accessibility
 * labels we match against deterministic.
 */
export const HISTORY_URL = 'https://www.youtube.com/feed/history?hl=en';

export type ItemKind = 'short' | 'video' | 'other';

export interface HistoryEntry {
  /** Value of MARK_ATTR — a stable handle on the element for this session. */
  key: string;
  kind: ItemKind;
  videoId: string | null;
  url: string;
  title: string;
  channel: string;
  /** The date heading the entry sits under, e.g. "Today", "Yesterday". */
  section: string;
}

export type RemovalStatus = 'removed' | 'failed' | 'skipped';

export interface RemovalResult {
  entry: HistoryEntry;
  status: RemovalStatus;
  /** Which control-location strategy was used, and the label of what was clicked. */
  strategy: string | null;
  buttonLabel: string | null;
  reason: string | null;
}

export interface HarvestSummary {
  total: number;
  /** Every harvested row, in document order. */
  all: HistoryEntry[];
  shorts: HistoryEntry[];
  videos: number;
  other: number;
  scrolls: number;
  reachedEnd: boolean;
}

/* -------------------------------------------------------------------------- */
/* Page-side helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Injects DOM helpers as `window.__ytc` before any navigation. Done through an
 * init script rather than `eval()` inside `page.evaluate`, because youtube.com
 * ships a Content-Security-Policy that can forbid `eval` in page context.
 *
 * The helpers pierce shadow roots: YouTube's `ytd-*` Polymer components put
 * their content behind shadow boundaries in some rollouts and in light DOM in
 * others, so every traversal has to handle both.
 */
export const installHelpers = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    // Current YouTube renders history with the view-model components; the
    // legacy ytd-* renderers are kept as a fallback for older rollouts.
    // Shorts arrive as tiles inside a ytd-reel-shelf-renderer carousel,
    // regular videos as yt-lockup-view-model rows.
    const ITEM_TAGS = [
      'yt-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2',
      'ytm-shorts-lockup-view-model',
      'ytd-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-playlist-video-renderer',
      'ytd-reel-item-renderer',
    ];

    const REMOVE_RE =
      /(remove from watch history|remove from history|κατάργηση από το ιστορικό|αφαίρεση από το ιστορικό)/i;
    const MENU_RE =
      /(action menu|more actions|μενού ενεργειών|περισσότερες ενέργειες)/i;

    const isItemTag = (el: Element): boolean =>
      ITEM_TAGS.indexOf(el.tagName.toLowerCase()) !== -1;

    const deepFindAll = (root: Element | Document, predicate: (el: Element) => boolean): Element[] => {
      const found: Element[] = [];
      const stack: Array<Element | ShadowRoot> = [];
      const seed = (root as Document).documentElement ?? (root as Element);
      stack.push(seed as Element);
      while (stack.length > 0) {
        const node = stack.pop();
        if (node === undefined) continue;
        if ((node as Element).nodeType === 1 && predicate(node as Element)) found.push(node as Element);
        const shadow = (node as Element).shadowRoot;
        const kids: Element[] = [];
        if (shadow !== null && shadow !== undefined) kids.push(...Array.from(shadow.children));
        kids.push(...Array.from(node.children));
        // Push in reverse so children pop in document order — callers rely on
        // `deepFindAll` returning history rows newest-first, which is what
        // `--limit` acts on.
        for (let index = kids.length - 1; index >= 0; index -= 1) {
          stack.push(kids[index] as Element);
        }
      }
      return found;
    };

    const deepFindFirst = (
      root: Element | Document,
      predicate: (el: Element) => boolean,
    ): Element | null => {
      const all = deepFindAll(root, predicate);
      return all.length > 0 ? (all[0] as Element) : null;
    };

    const deepParent = (el: Node): Element | null => {
      const parent = el.parentNode;
      if (parent === null) return null;
      if (parent.nodeType === 11) return (parent as ShadowRoot).host ?? null;
      return parent.nodeType === 1 ? (parent as Element) : null;
    };

    const hasItemAncestor = (el: Element): boolean => {
      let cur = deepParent(el);
      while (cur !== null) {
        if (isItemTag(cur)) return true;
        cur = deepParent(cur);
      }
      return false;
    };

    const sectionOf = (el: Element): string => {
      let cur: Element | null = el;
      while (cur !== null) {
        if (cur.tagName.toLowerCase() === 'ytd-item-section-renderer') {
          const header = deepFindFirst(cur, (n) => n.id === 'header' || n.id === 'title');
          const text = header === null ? '' : (header.textContent ?? '').trim();
          return (text.split('\n')[0] ?? '').trim();
        }
        cur = deepParent(cur);
      }
      return '';
    };

    const labelOf = (el: Element): string =>
      (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el.textContent ?? '')).trim();

    const isClickable = (el: Element): boolean => {
      const tag = el.tagName.toLowerCase();
      return tag === 'button' || tag === 'yt-icon-button' || el.getAttribute('role') === 'button';
    };

    const linkOf = (el: Element): string => {
      const anchor = deepFindFirst(el, (candidate) => {
        if (candidate.tagName.toLowerCase() !== 'a') return false;
        const href = candidate.getAttribute('href') ?? '';
        return href.includes('/shorts/') || href.includes('/watch');
      });
      return anchor === null ? '' : (anchor.getAttribute('href') ?? '');
    };

    const marked = (attr: string, value: string): Element | null =>
      deepFindFirst(document, (el) => el.getAttribute(attr) === value);

    (window as unknown as Record<string, unknown>)['__ytc'] = {
      ITEM_TAGS,
      REMOVE_RE,
      MENU_RE,
      isItemTag,
      deepFindAll,
      deepFindFirst,
      deepParent,
      hasItemAncestor,
      sectionOf,
      labelOf,
      isClickable,
      linkOf,
      marked,
    };
  });
};

/** Shape of `window.__ytc`, used only to type the page-side callbacks. */
interface Helpers {
  ITEM_TAGS: string[];
  REMOVE_RE: RegExp;
  MENU_RE: RegExp;
  isItemTag: (el: Element) => boolean;
  deepFindAll: (root: Element | Document, p: (el: Element) => boolean) => Element[];
  deepFindFirst: (root: Element | Document, p: (el: Element) => boolean) => Element | null;
  deepParent: (el: Node) => Element | null;
  hasItemAncestor: (el: Element) => boolean;
  sectionOf: (el: Element) => string;
  labelOf: (el: Element) => string;
  isClickable: (el: Element) => boolean;
  linkOf: (el: Element) => string;
  marked: (attr: string, value: string) => Element | null;
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

export const openHistory = async (page: Page): Promise<void> => {
  log.step('Opening YouTube watch history');
  await page.goto(HISTORY_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  // The history page is a client-rendered SPA: the account avatar and the feed
  // appear well after domcontentloaded. Checking sign-in before hydration
  // reports a false "not signed in".
  await page
    .waitForSelector('#avatar-btn, ytd-browse[page-subtype="history"]', { timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2_500);

  const state = await page.evaluate(() => ({
    signedIn: document.querySelector('#avatar-btn, ytd-topbar-menu-button-renderer') !== null,
    isHistory: document.querySelector('ytd-browse[page-subtype="history"]') !== null,
    hasSignInCta: document.querySelector('a[href*="accounts.google.com/ServiceLogin"]') !== null,
    url: location.href,
    title: document.title,
  }));

  if (/accounts\.google\.com|\/signin/.test(state.url)) {
    throw new YouTubeStateError(
      'Chrome redirected to the Google sign-in page. Sign in to YouTube in that window, then re-run.',
    );
  }
  if (!state.signedIn || state.hasSignInCta) {
    throw new YouTubeStateError(
      'The attached Chrome does not appear to be signed in to YouTube. ' +
        'Sign in in that browser window, then re-run.',
    );
  }
  if (!state.isHistory) {
    throw new YouTubeStateError(
      `Did not land on the watch-history page (got "${state.title}" at ${state.url}). ` +
        'YouTube may have changed its layout, or history may be turned off for this account.',
    );
  }

  await page
    .waitForSelector(
      'yt-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-item-section-renderer',
      { timeout: 20_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(1_500);

  log.ok('Watch history loaded');
};

/* -------------------------------------------------------------------------- */
/* Harvest                                                                    */
/* -------------------------------------------------------------------------- */

const scrollToBottom = async (page: Page): Promise<number> =>
  page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return document.documentElement.scrollHeight;
  });

export const harvest = async (
  page: Page,
  maxScrolls: number,
  onProgress?: (scrolls: number, loadedRows: number) => void,
): Promise<HarvestSummary> => {
  let scrolls = 0;
  let stagnant = 0;
  let lastHeight = await scrollToBottom(page);
  let reachedEnd = maxScrolls === 0;

  while (scrolls < maxScrolls) {
    await page.waitForTimeout(900);
    const height = await scrollToBottom(page);
    scrolls += 1;

    if (height <= lastHeight) {
      stagnant += 1;
      // Two consecutive no-growth scrolls means YouTube has nothing left to load.
      if (stagnant >= 2) {
        reachedEnd = true;
        break;
      }
    } else {
      stagnant = 0;
    }
    lastHeight = height;

    if (onProgress !== undefined && scrolls % 5 === 0) {
      const rows = await page
        .evaluate(() => {
          const h = (window as unknown as Record<string, unknown>)['__ytc'] as Helpers;
          return h.deepFindAll(document, (el) => h.isItemTag(el)).length;
        })
        .catch(() => -1);
      onProgress(scrolls, rows);
    }
  }

  const entries = await page.evaluate((markAttr: string) => {
    const h = (window as unknown as Record<string, unknown>)['__ytc'] as Helpers;
    const items = h
      .deepFindAll(document, (el) => h.isItemTag(el))
      .filter((el) => !h.hasItemAncestor(el));

    return items.map((el, index) => {
      const href = h.linkOf(el);
      const absolute = href === '' ? '' : new URL(href, location.origin).toString();

      let kind: string = 'other';
      let videoId: string | null = null;
      const shortMatch = /\/shorts\/([A-Za-z0-9_-]+)/.exec(href);
      const watchMatch = /[?&]v=([A-Za-z0-9_-]+)/.exec(href);
      if (shortMatch !== null) {
        kind = 'short';
        videoId = shortMatch[1] ?? null;
      } else if (watchMatch !== null) {
        kind = 'video';
        videoId = watchMatch[1] ?? null;
      }

      const key = `i${index}`;
      el.setAttribute(markAttr, key);

      const titleEl = h.deepFindFirst(
        el,
        (candidate) => candidate.id === 'video-title' || candidate.id === 'video-title-link',
      );
      const title = (
        titleEl === null
          ? (h.deepFindFirst(el, (c) => c.hasAttribute('title'))?.getAttribute('title') ?? '')
          : (titleEl.getAttribute('title') ?? titleEl.textContent ?? '')
      ).trim();

      const channelEl = h.deepFindFirst(
        el,
        (candidate) =>
          candidate.tagName.toLowerCase() === 'ytd-channel-name' || candidate.id === 'channel-name',
      );
      const channel = channelEl === null ? '' : (channelEl.textContent ?? '').replace(/\s+/g, ' ').trim();

      return { key, kind, videoId, url: absolute, title, channel, section: h.sectionOf(el) };
    });
  }, MARK_ATTR);

  const typed = entries as unknown as HistoryEntry[];

  return {
    total: typed.length,
    all: typed,
    shorts: typed.filter((entry) => entry.kind === 'short'),
    videos: typed.filter((entry) => entry.kind === 'video').length,
    other: typed.filter((entry) => entry.kind === 'other').length,
    scrolls,
    reachedEnd,
  };
};

/* -------------------------------------------------------------------------- */
/* Removal                                                                    */
/* -------------------------------------------------------------------------- */

export interface AttemptOptions {
  actionDelayMs: number;
  limit: number | null;
  onAttempt?: (done: number, total: number, entry: HistoryEntry, clicked: boolean) => void;
}

export interface Attempt {
  entry: HistoryEntry;
  clicked: boolean;
  strategy: string | null;
  reason: string | null;
}

/**
 * Opens a row's "More actions" menu and clicks its "Remove from watch history"
 * entry.
 *
 * Two details of the current markup matter. The menu entry host carries
 * `role="presentation"`; the element that actually handles the tap is the inner
 * `.ytListItemViewModelTappable`. And the click is NOT confirmed by the row
 * disappearing — YouTube leaves the tile in the Shorts carousel and only shows
 * a toast — so callers verify by reloading, never by detachment.
 */
const clickRemoveInMenu = async (
  page: Page,
  key: string,
): Promise<{ ok: boolean; strategy: string | null; reason: string | null }> => {
  // A dropdown left open from the previous row swallows the next click.
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(150);

  const opened = await page.evaluate(
    ({ markAttr, menuAttr, itemKey }: { markAttr: string; menuAttr: string; itemKey: string }) => {
      const h = (window as unknown as Record<string, unknown>)['__ytc'] as Helpers;
      const item = h.marked(markAttr, itemKey);
      if (item === null) return 'stale';
      const triggers = h.deepFindAll(
        item,
        (el) => h.isClickable(el) && h.MENU_RE.test(h.labelOf(el)),
      );
      if (triggers.length === 0) return 'no-trigger';
      (triggers[0] as Element).setAttribute(menuAttr, itemKey);
      return 'ok';
    },
    { markAttr: MARK_ATTR, menuAttr: MENU_ATTR, itemKey: key },
  );

  if (opened === 'stale') return { ok: false, strategy: null, reason: 'row no longer in DOM' };
  if (opened === 'no-trigger') {
    return { ok: false, strategy: null, reason: 'no "More actions" control on this row' };
  }

  try {
    await page.locator(`[${MENU_ATTR}="${key}"]`).click({ timeout: 10_000 });
  } catch (error) {
    return {
      ok: false,
      strategy: 'more-actions',
      reason: `could not open the action menu: ${(error as Error).message.split('\n')[0] ?? ''}`,
    };
  }

  const entry = page
    .locator('tp-yt-iron-dropdown:visible')
    .locator('yt-list-item-view-model, ytd-menu-service-item-renderer, tp-yt-paper-item')
    .filter({ hasText: /remove from watch history/i })
    .first();

  try {
    await entry.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => undefined);
    return {
      ok: false,
      strategy: 'more-actions',
      reason: 'menu had no "Remove from watch history" entry',
    };
  }

  const tappable = entry.locator('.ytListItemViewModelTappable').first();
  const target = (await tappable.count()) > 0 ? tappable : entry;

  try {
    await target.click({ timeout: 10_000 });
  } catch (error) {
    await page.keyboard.press('Escape').catch(() => undefined);
    return {
      ok: false,
      strategy: 'more-actions',
      reason: `could not click the remove entry: ${(error as Error).message.split('\n')[0] ?? ''}`,
    };
  }

  return { ok: true, strategy: 'more-actions', reason: null };
};

export const attemptRemovals = async (
  page: Page,
  shorts: HistoryEntry[],
  options: AttemptOptions,
): Promise<Attempt[]> => {
  const attempts: Attempt[] = [];
  const target = options.limit === null ? shorts.length : Math.min(options.limit, shorts.length);

  for (let index = 0; index < target; index += 1) {
    const entry = shorts[index] as HistoryEntry;
    const result = await clickRemoveInMenu(page, entry.key);
    attempts.push({
      entry,
      clicked: result.ok,
      strategy: result.strategy,
      reason: result.reason,
    });
    options.onAttempt?.(index + 1, target, entry, result.ok);
    if (options.actionDelayMs > 0) await page.waitForTimeout(options.actionDelayMs);
  }

  return attempts;
};

/* -------------------------------------------------------------------------- */
/* Iterative clearing                                                         */
/* -------------------------------------------------------------------------- */

export interface ClearOptions {
  maxScrolls: number;
  actionDelayMs: number;
  limit: number | null;
  maxRounds: number;
  onRound?: (round: number, pending: number) => void;
  onAttempt?: (done: number, total: number, entry: HistoryEntry, clicked: boolean) => void;
  onVerified?: (removed: number, remaining: number) => void;
}

export interface ClearOutcome {
  firstScan: HarvestSummary;
  removals: RemovalResult[];
  rounds: number;
}

/**
 * Clears Shorts in verify-by-reload rounds.
 *
 * Each round harvests the feed, clicks Remove on every Short it found, then
 * reloads and re-harvests. Whatever disappeared is confirmed removed; whatever
 * survived is reported as failed. Reload is the only trustworthy signal here,
 * because the Shorts carousel keeps showing tiles that the server has already
 * dropped from history.
 */
export const clearShorts = async (page: Page, options: ClearOptions): Promise<ClearOutcome> => {
  const removals: RemovalResult[] = [];
  const givenUp = new Set<string>();
  let firstScan: HarvestSummary | null = null;
  let round = 0;
  let removedTotal = 0;

  while (round < options.maxRounds) {
    round += 1;

    const summary = await harvest(page, round === 1 ? options.maxScrolls : options.maxScrolls);
    if (firstScan === null) firstScan = summary;

    const pending = summary.shorts.filter(
      (entry) => entry.videoId === null || !givenUp.has(entry.videoId),
    );
    options.onRound?.(round, pending.length);
    if (pending.length === 0) break;

    const budget = options.limit === null ? null : options.limit - removedTotal;
    if (budget !== null && budget <= 0) break;

    const attempts = await attemptRemovals(page, pending, {
      actionDelayMs: options.actionDelayMs,
      limit: budget,
      ...(options.onAttempt === undefined ? {} : { onAttempt: options.onAttempt }),
    });

    // Ground truth: reload and see what actually went.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page
      .waitForSelector('yt-lockup-view-model, ytm-shorts-lockup-view-model-v2', { timeout: 25_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2_500);

    const after = await harvest(page, options.maxScrolls);
    const survivors = new Set(
      after.shorts.map((entry) => entry.videoId).filter((id): id is string => id !== null),
    );

    let removedThisRound = 0;
    for (const attempt of attempts) {
      const id = attempt.entry.videoId;
      const gone = id !== null && !survivors.has(id);
      if (gone) {
        removedThisRound += 1;
        removals.push({
          entry: attempt.entry,
          status: 'removed',
          strategy: attempt.strategy,
          buttonLabel: 'Remove from watch history',
          reason: null,
        });
      } else {
        removals.push({
          entry: attempt.entry,
          status: attempt.clicked ? 'failed' : 'skipped',
          strategy: attempt.strategy,
          buttonLabel: null,
          reason: attempt.clicked
            ? 'clicked Remove but the entry survived a reload'
            : attempt.reason,
        });
        if (id !== null) givenUp.add(id);
      }
    }

    removedTotal += removedThisRound;
    options.onVerified?.(removedThisRound, after.shorts.length);

    if (removedThisRound === 0) break;
  }

  return {
    firstScan: firstScan ?? {
      total: 0,
      all: [],
      shorts: [],
      videos: 0,
      other: 0,
      scrolls: 0,
      reachedEnd: true,
    },
    removals,
    rounds: round,
  };
};

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

export interface RowProbe {
  key: string;
  title: string;
  videoId: string | null;
  /** False when the harvest mark is gone, i.e. the feed re-rendered. */
  present: boolean;
  /** Whether this row exposes the "More actions" control removal goes through. */
  triggerFound: boolean;
  triggerLabel: string | null;
  /** Every labelled control on the row, for diagnosing a layout change. */
  controlLabels: string[];
}

export interface MenuProbe {
  opened: boolean;
  entries: string[];
  removeEntryFound: boolean;
  removeEntryText: string | null;
  /** The inner element that actually handles the tap; the host ignores clicks. */
  tappableFound: boolean;
  reason: string | null;
}

/** Reports whether a row exposes the "More actions" trigger. Clicks nothing. */
export const probeRow = async (page: Page, entry: HistoryEntry): Promise<RowProbe> => {
  const info = await page.evaluate(
    ({ markAttr, itemKey }: { markAttr: string; itemKey: string }) => {
      const h = (window as unknown as Record<string, unknown>)['__ytc'] as Helpers;
      const item = h.marked(markAttr, itemKey);
      if (item === null) {
        return { present: false, triggerFound: false, triggerLabel: null, controlLabels: [] };
      }
      const clickables = h.deepFindAll(item, (el) => h.isClickable(el));
      const labels = clickables.map((el) => h.labelOf(el)).filter((label) => label !== '');
      const trigger = clickables.filter((el) => h.MENU_RE.test(h.labelOf(el)))[0] ?? null;
      return {
        present: true,
        triggerFound: trigger !== null,
        triggerLabel: trigger === null ? null : h.labelOf(trigger),
        controlLabels: labels.slice(0, 12),
      };
    },
    { markAttr: MARK_ATTR, itemKey: entry.key },
  );

  return { key: entry.key, title: entry.title, videoId: entry.videoId, ...info };
};

/**
 * Opens one row's "More actions" menu, confirms the "Remove from watch history"
 * entry and its inner tappable element are present, then closes the menu again.
 *
 * The Remove entry is never clicked, so this stays non-destructive while still
 * exercising the exact path `clearShorts` uses.
 */
export const probeMenu = async (page: Page, entry: HistoryEntry): Promise<MenuProbe> => {
  const blank: MenuProbe = {
    opened: false,
    entries: [],
    removeEntryFound: false,
    removeEntryText: null,
    tappableFound: false,
    reason: null,
  };

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(150);

  const stamped = await page.evaluate(
    ({ markAttr, menuAttr, itemKey }: { markAttr: string; menuAttr: string; itemKey: string }) => {
      const h = (window as unknown as Record<string, unknown>)['__ytc'] as Helpers;
      const item = h.marked(markAttr, itemKey);
      if (item === null) return 'stale';
      const triggers = h.deepFindAll(
        item,
        (el) => h.isClickable(el) && h.MENU_RE.test(h.labelOf(el)),
      );
      if (triggers.length === 0) return 'no-trigger';
      (triggers[0] as Element).setAttribute(menuAttr, itemKey);
      return 'ok';
    },
    { markAttr: MARK_ATTR, menuAttr: MENU_ATTR, itemKey: entry.key },
  );

  if (stamped === 'stale') return { ...blank, reason: 'row no longer in DOM' };
  if (stamped === 'no-trigger') {
    return { ...blank, reason: 'no "More actions" control on this row' };
  }

  try {
    await page.locator(`[${MENU_ATTR}="${entry.key}"]`).click({ timeout: 10_000 });
  } catch (error) {
    return {
      ...blank,
      reason: `could not open the action menu: ${(error as Error).message.split('\n')[0] ?? ''}`,
    };
  }
  await page.waitForTimeout(1_200);

  const entries = await page.evaluate(() => {
    const h = (window as unknown as Record<string, unknown>)['__ytc'] as Helpers;
    const dropdowns = h
      .deepFindAll(document, (el) => el.tagName.toLowerCase() === 'tp-yt-iron-dropdown')
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const texts: string[] = [];
    for (const dropdown of dropdowns) {
      const items = h.deepFindAll(dropdown, (el) =>
        ['yt-list-item-view-model', 'ytd-menu-service-item-renderer', 'tp-yt-paper-item'].includes(
          el.tagName.toLowerCase(),
        ),
      );
      for (const item of items) {
        const text = (item.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text !== '') texts.push(text);
      }
    }
    return texts;
  });

  const removeEntry = page
    .locator('tp-yt-iron-dropdown:visible')
    .locator('yt-list-item-view-model, ytd-menu-service-item-renderer, tp-yt-paper-item')
    .filter({ hasText: /remove from watch history/i })
    .first();

  const removeEntryFound = (await removeEntry.count()) > 0;
  let removeEntryText: string | null = null;
  let tappableFound = false;
  if (removeEntryFound) {
    removeEntryText = (await removeEntry.textContent())?.replace(/\s+/g, ' ').trim() ?? null;
    tappableFound = (await removeEntry.locator('.ytListItemViewModelTappable').count()) > 0;
  }

  // Close the menu without touching anything in it.
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(300);

  return {
    opened: true,
    entries,
    removeEntryFound,
    removeEntryText,
    tappableFound,
    reason: removeEntryFound ? null : 'menu opened but had no "Remove from watch history" entry',
  };
};
