import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HarvestSummary, HistoryEntry, RemovalResult } from './youtube.js';

export interface ManifestMeta {
  tool: string;
  version: string;
  mode: 'scan' | 'apply';
  startedAt: string;
  finishedAt: string;
  cdpUrl: string;
  maxScrolls: number;
  actionDelayMs: number;
  limit: number | null;
}

export interface Manifest {
  meta: ManifestMeta;
  summary: {
    rowsSeen: number;
    shortsFound: number;
    regularVideos: number;
    unclassified: number;
    scrolls: number;
    reachedEndOfHistory: boolean;
    removed: number;
    failed: number;
    skipped: number;
  };
  shorts: HistoryEntry[];
  /**
   * Every row seen in the scan, not just Shorts. Recorded so a later run can be
   * diffed against this one to prove nothing outside Shorts was touched.
   */
  entries: HistoryEntry[];
  removals: RemovalResult[];
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const timestamp = (iso: string): string => iso.replace(/[:.]/g, '-').replace(/Z$/, 'Z');

export interface WrittenManifest {
  jsonPath: string;
  csvPath: string;
}

export const writeManifest = (
  outputDir: string,
  harvestSummary: HarvestSummary,
  removals: RemovalResult[],
  meta: ManifestMeta,
): WrittenManifest => {
  mkdirSync(outputDir, { recursive: true });

  const manifest: Manifest = {
    meta,
    summary: {
      rowsSeen: harvestSummary.total,
      shortsFound: harvestSummary.shorts.length,
      regularVideos: harvestSummary.videos,
      unclassified: harvestSummary.other,
      scrolls: harvestSummary.scrolls,
      reachedEndOfHistory: harvestSummary.reachedEnd,
      removed: removals.filter((r) => r.status === 'removed').length,
      failed: removals.filter((r) => r.status === 'failed').length,
      skipped: removals.filter((r) => r.status === 'skipped').length,
    },
    shorts: harvestSummary.shorts,
    entries: harvestSummary.all,
    removals,
  };

  const stamp = timestamp(meta.startedAt);
  const base = `youtube-cleanup-${meta.mode}-${stamp}`;
  const jsonPath = resolve(outputDir, `${base}.json`);
  const csvPath = resolve(outputDir, `${base}.csv`);

  writeFileSync(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const statusByKey = new Map(removals.map((r) => [r.entry.key, r]));
  const header = ['videoId', 'title', 'channel', 'section', 'url', 'status', 'strategy', 'reason'];
  const rows = harvestSummary.shorts.map((entry) => {
    const removal = statusByKey.get(entry.key);
    return [
      entry.videoId,
      entry.title,
      entry.channel,
      entry.section,
      entry.url,
      removal === undefined ? (meta.mode === 'scan' ? 'would-remove' : 'not-attempted') : removal.status,
      removal?.strategy ?? '',
      removal?.reason ?? '',
    ]
      .map(csvCell)
      .join(',');
  });

  writeFileSync(csvPath, `${[header.join(','), ...rows].join('\n')}\n`, 'utf8');

  return { jsonPath, csvPath };
};
