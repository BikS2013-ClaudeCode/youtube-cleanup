#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { Command, Option } from 'commander';
import { attach } from './browser.js';
import { configVarNames, loadConfig, resolveAll, toolConfigDir, TOOL_NAME } from './config.js';
import { BrowserError, ConfigurationError, YouTubeStateError } from './errors.js';
import { log, setVerbose } from './logger.js';
import { writeManifest, type ManifestMeta } from './manifest.js';
import {
  clearShorts,
  harvest,
  installHelpers,
  openHistory,
  probeMenu,
  probeRow,
  type HistoryEntry,
  type RemovalResult,
} from './youtube.js';

const VERSION = '1.0.0';

interface CommonFlags {
  cdpUrl?: string;
  outputDir?: string;
  maxScrolls?: string;
  delayMs?: string;
  verbose?: boolean;
}

const overridesFrom = (flags: CommonFlags & { maxPasses?: string }) => ({
  cdpUrl: flags.cdpUrl,
  outputDir: flags.outputDir,
  maxScrolls: flags.maxScrolls,
  actionDelayMs: flags.delayMs,
  maxPasses: flags.maxPasses,
});

const parseLimit = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigurationError(`--limit must be a non-negative integer, got "${raw}".`);
  }
  return Number.parseInt(raw, 10);
};

const describe = (entry: HistoryEntry): string => {
  const title = entry.title === '' ? '(untitled)' : entry.title;
  const channel = entry.channel === '' ? '' : ` — ${entry.channel}`;
  return `${title}${channel}`;
};

const confirm = async (question: string): Promise<boolean> => {
  if (!process.stdin.isTTY) {
    throw new ConfigurationError(
      'Refusing to delete without confirmation on a non-interactive stdin. Pass --yes to proceed.',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

const printHarvest = (
  rowsSeen: number,
  shorts: HistoryEntry[],
  videos: number,
  other: number,
  reachedEnd: boolean,
  scrolls: number,
): void => {
  log.info('');
  log.ok(`Scanned ${rowsSeen} history entries over ${scrolls} scroll(s)`);
  log.detail(`Shorts (/shorts/ links): ${shorts.length}`);
  log.detail(`Regular videos (left untouched): ${videos}`);
  if (other > 0) log.detail(`Unclassified rows (left untouched): ${other}`);
  log.detail(
    reachedEnd
      ? 'Reached the end of the loaded history.'
      : `Stopped at the ${configVarNames.maxScrolls} limit — older history was not loaded.`,
  );
};

const listShorts = (shorts: HistoryEntry[], limit: number | null): void => {
  if (shorts.length === 0) return;
  log.info('');
  const shown = limit === null ? shorts : shorts.slice(0, limit);
  for (const entry of shown) {
    log.info(`  • ${describe(entry)}`);
    log.detail(`${entry.section === '' ? '' : `${entry.section} · `}${entry.url}`);
  }
  if (limit !== null && shorts.length > shown.length) {
    log.detail(`… and ${shorts.length - shown.length} more not in scope of --limit`);
  }
};

/* -------------------------------------------------------------------------- */

const runShorts = async (
  flags: CommonFlags & { apply?: boolean; limit?: string; yes?: boolean; maxPasses?: string },
) => {
  setVerbose(flags.verbose === true);
  const config = loadConfig(overridesFrom(flags));
  const limit = parseLimit(flags.limit);
  const apply = flags.apply === true;
  const startedAt = new Date().toISOString();

  log.detail(`CDP endpoint : ${config.cdpUrl}`);
  log.detail(`Output dir   : ${config.outputDir}`);
  log.detail(`Max scrolls  : ${config.maxScrolls}`);
  log.detail(`Action delay : ${config.actionDelayMs} ms`);
  log.detail(`Max passes   : ${config.maxPasses}`);
  log.detail(`Mode         : ${apply ? 'APPLY (will delete)' : 'dry run (no deletion)'}`);

  const session = await attach(config.cdpUrl);
  let removals: RemovalResult[] = [];

  try {
    await installHelpers(session.page);
    await openHistory(session.page);

    log.step(`Scrolling the history feed (up to ${config.maxScrolls} scroll(s))`);
    const summary = await harvest(session.page, config.maxScrolls, (scrolls, rows) => {
      log.debug(`scroll ${scrolls}: ${rows} rows loaded`);
    });

    printHarvest(summary.total, summary.shorts, summary.videos, summary.other, summary.reachedEnd, summary.scrolls);

    if (summary.shorts.length === 0) {
      log.info('');
      log.ok('No Shorts found in the loaded history. Nothing to do.');
    } else if (!apply) {
      listShorts(summary.shorts, limit);
      log.info('');
      log.warn(
        `Dry run — nothing was deleted. Re-run with --apply to remove ${
          limit === null ? summary.shorts.length : Math.min(limit, summary.shorts.length)
        } Short(s).`,
      );
    } else {
      const target = limit === null ? summary.shorts.length : Math.min(limit, summary.shorts.length);
      listShorts(summary.shorts, limit);
      log.info('');

      if (flags.yes !== true) {
        const proceed = await confirm(
          `Permanently remove ${target} Short(s) from your watch history? This cannot be undone by this tool.`,
        );
        if (!proceed) {
          log.warn('Aborted at confirmation — nothing was deleted.');
          const meta: ManifestMeta = {
            tool: TOOL_NAME,
            version: VERSION,
            mode: 'scan',
            startedAt,
            finishedAt: new Date().toISOString(),
            cdpUrl: config.cdpUrl,
            maxScrolls: config.maxScrolls,
            actionDelayMs: config.actionDelayMs,
            limit,
          };
          const written = writeManifest(config.outputDir, summary, [], meta);
          log.detail(`Manifest: ${written.jsonPath}`);
          return;
        }
      }

      log.step(`Removing ${target} Short(s)`);
      const outcome = await clearShorts(session.page, {
        maxScrolls: config.maxScrolls,
        actionDelayMs: config.actionDelayMs,
        limit,
        maxRounds: config.maxPasses,
        onRound: (round, pending) => {
          log.detail(`pass ${round}: ${pending} Short(s) to remove`);
        },
        onAttempt: (done, total, entry, clicked) => {
          log.info(`  ${clicked ? '·' : '✗'} [${done}/${total}] ${describe(entry)}`);
        },
        onVerified: (removed, remaining) => {
          log.ok(`verified after reload: ${removed} removed, ${remaining} Short(s) still in history`);
        },
      });
      removals = outcome.removals;

      const removed = removals.filter((r) => r.status === 'removed').length;
      const failed = removals.filter((r) => r.status === 'failed');
      const skipped = removals.filter((r) => r.status === 'skipped');

      log.info('');
      log.ok(`Removed ${removed} Short(s) from watch history`);
      if (skipped.length > 0) log.detail(`Skipped: ${skipped.length}`);
      if (failed.length > 0) {
        log.warn(`Failed: ${failed.length}`);
        for (const failure of failed.slice(0, 5)) {
          log.detail(`${describe(failure.entry)} — ${failure.reason ?? 'unknown reason'}`);
        }
      }
    }

    const meta: ManifestMeta = {
      tool: TOOL_NAME,
      version: VERSION,
      mode: apply ? 'apply' : 'scan',
      startedAt,
      finishedAt: new Date().toISOString(),
      cdpUrl: config.cdpUrl,
      maxScrolls: config.maxScrolls,
      actionDelayMs: config.actionDelayMs,
      limit,
    };
    const written = writeManifest(config.outputDir, summary, removals, meta);
    log.info('');
    log.detail(`Manifest JSON: ${written.jsonPath}`);
    log.detail(`Manifest CSV : ${written.csvPath}`);
  } finally {
    await session.detach();
  }
};

const runDoctor = async (flags: CommonFlags) => {
  setVerbose(flags.verbose === true);
  const config = loadConfig(overridesFrom(flags));
  const problems: string[] = [];

  log.step('Checking configuration');
  const resolved = resolveAll(overridesFrom(flags));
  for (const [key, name] of Object.entries(configVarNames)) {
    const entry = resolved[key as keyof typeof configVarNames];
    log.detail(`${name} = ${entry.value}   (from ${entry.source})`);
  }

  const session = await attach(config.cdpUrl);
  try {
    log.ok('Attached to Chrome');
    await installHelpers(session.page);
    await openHistory(session.page);
    log.ok('Signed in, watch history reachable');

    log.step('Sampling the first screen of history (no scrolling, nothing removed)');
    const summary = await harvest(session.page, 0);
    log.detail(`history entries on screen : ${summary.total}`);
    log.detail(`Shorts (/shorts/ links)   : ${summary.shorts.length}`);
    log.detail(`regular videos            : ${summary.videos}`);
    if (summary.other > 0) log.detail(`unclassified rows         : ${summary.other}`);

    if (summary.total === 0) {
      log.error('No history rows recognised — YouTube has changed its markup.');
      log.detail('The item tags in installHelpers() need updating.');
      process.exitCode = 1;
      return;
    }

    if (summary.shorts.length === 0) {
      log.info('');
      log.ok('No Shorts on the first screen — nothing would be removed right now.');
      const fallback = summary.all.find((entry) => entry.kind === 'video');
      if (fallback === undefined) {
        log.warn('No regular video row either, so the removal path cannot be exercised.');
        return;
      }
      log.step('Exercising the same controls on a regular video row (Remove is NOT clicked)');
      log.detail('Shorts and regular rows share one removal path, so this still validates it.');
      const row = await probeRow(session.page, fallback);
      if (row.triggerFound) {
        log.ok(`trigger: "${row.triggerLabel}"`);
      } else {
        log.error('No "More actions" control on this row');
        log.detail(`controls found: ${row.controlLabels.join(' | ') || '(none labelled)'}`);
        process.exitCode = 1;
        return;
      }
      const menu = await probeMenu(session.page, fallback);
      log.info('');
      if (menu.opened && menu.removeEntryFound && menu.tappableFound) {
        log.detail(`menu entries: ${menu.entries.join(' | ')}`);
        log.ok('READY — the removal path is intact end to end.');
      } else {
        log.error(`NOT READY — ${menu.reason ?? 'the remove entry was not usable'}`);
        if (menu.entries.length > 0) log.detail(`menu entries: ${menu.entries.join(' | ')}`);
        process.exitCode = 1;
      }
      return;
    }

    log.step('Checking the "More actions" control on the first 3 Shorts (not clicking)');
    for (const entry of summary.shorts.slice(0, 3)) {
      const probe = await probeRow(session.page, entry);
      const title = probe.title === '' ? '(untitled)' : probe.title;
      if (probe.triggerFound) {
        log.ok(title);
        log.detail(`trigger: "${probe.triggerLabel}"`);
      } else {
        log.error(title);
        log.detail(`controls found on this row: ${probe.controlLabels.join(' | ') || '(none labelled)'}`);
        problems.push(`no "More actions" control on ${title}`);
      }
    }

    const menuTarget = summary.shorts[0] as HistoryEntry;
    log.step('Opening that Short\'s menu to confirm the Remove entry (menu is closed again)');
    const menu = await probeMenu(session.page, menuTarget);

    if (!menu.opened) {
      log.error(`Could not open the action menu — ${menu.reason ?? 'unknown reason'}`);
      problems.push('action menu would not open');
    } else {
      log.detail(`menu entries: ${menu.entries.join(' | ') || '(none)'}`);
      if (menu.removeEntryFound) {
        log.ok(`Found the remove entry: "${menu.removeEntryText}"`);
      } else {
        log.error('Menu opened but has no "Remove from watch history" entry');
        problems.push('no remove entry in the action menu');
      }
      if (menu.removeEntryFound && !menu.tappableFound) {
        log.error('Remove entry has no .ytListItemViewModelTappable inner element');
        log.detail('The entry host ignores clicks, so removal would silently do nothing.');
        problems.push('remove entry has no tappable inner element');
      }
    }

    log.info('');
    if (problems.length === 0) {
      log.ok('READY — the removal path is intact end to end.');
      log.detail('Removal is confirmed by reloading, never by the row disappearing:');
      log.detail('YouTube leaves Shorts tiles on screen after removing them from history.');
    } else {
      log.error(`NOT READY — ${problems.length} problem(s) found:`);
      for (const problem of problems) log.detail(problem);
      log.detail('YouTube has most likely changed its markup; see src/youtube.ts.');
      process.exitCode = 1;
    }
  } finally {
    await session.detach();
  }
};

const runConfig = (flags: CommonFlags) => {
  setVerbose(flags.verbose === true);
  log.info(`Config folder: ${toolConfigDir()}`);
  log.info('Resolution order (lowest to highest priority):');
  log.detail('1. shell environment');
  log.detail(`2. ${toolConfigDir()}/.env`);
  log.detail('3. ./.env');
  log.detail('4. CLI flags');
  log.info('');
  const resolved = resolveAll(overridesFrom(flags));
  for (const [key, name] of Object.entries(configVarNames)) {
    const entry = resolved[key as keyof typeof configVarNames];
    log.info(`${name}=${entry.value}`);
    log.detail(`from ${entry.source}`);
  }
};

/* -------------------------------------------------------------------------- */

const withCommonFlags = (command: Command): Command =>
  command
    .addOption(new Option('--cdp-url <url>', `override ${configVarNames.cdpUrl}`))
    .addOption(new Option('--output-dir <path>', `override ${configVarNames.outputDir}`))
    .addOption(new Option('--max-scrolls <n>', `override ${configVarNames.maxScrolls}`))
    .addOption(new Option('--delay-ms <n>', `override ${configVarNames.actionDelayMs}`))
    .option('-v, --verbose', 'print per-step debug detail');

const program = new Command();

program
  .name(TOOL_NAME)
  .description(
    'Remove watched YouTube Shorts from your YouTube watch history, and nothing else.\n' +
      'Attaches to a Chrome you started with --remote-debugging-port, so it reuses your\n' +
      'existing signed-in session. Dry run by default; deletes only with --apply.',
  )
  .version(VERSION);

withCommonFlags(
  program
    .command('shorts', { isDefault: true })
    .description('find Shorts in your watch history and (with --apply) remove them')
    .option('--apply', 'actually delete the matched Shorts (default: dry run)')
    .option('--limit <n>', 'act on at most N Shorts, newest first')
    .option('--max-passes <n>', `override ${configVarNames.maxPasses}`)
    .option('-y, --yes', 'skip the interactive confirmation prompt when using --apply'),
).action(runShorts);

withCommonFlags(
  program
    .command('doctor')
    .description('verify Chrome attachment, sign-in, and remove-control detection; deletes nothing'),
).action(runDoctor);

withCommonFlags(
  program.command('config').description('show where each configuration value is resolved from'),
).action(runConfig);

const main = async (): Promise<void> => {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (
      error instanceof ConfigurationError ||
      error instanceof BrowserError ||
      error instanceof YouTubeStateError
    ) {
      log.error(`${error.name}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    log.error((error as Error).stack ?? String(error));
    process.exitCode = 1;
  }
};

void main();
