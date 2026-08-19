import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { ConfigurationError } from './errors.js';
import { log } from './logger.js';

export const TOOL_NAME = 'youtube-cleanup';

/** `~/.tool-agents/youtube-cleanup` — the tool's private configuration folder. */
export const toolConfigDir = (): string => resolve(homedir(), '.tool-agents', TOOL_NAME);

export interface Config {
  /** DevTools Protocol endpoint of the already-running Chrome to attach to. */
  cdpUrl: string;
  /** Absolute directory where scan/removal manifests are written. */
  outputDir: string;
  /** Upper bound on lazy-load scroll iterations while harvesting the history feed. */
  maxScrolls: number;
  /** Milliseconds to wait between consecutive removal actions. */
  actionDelayMs: number;
  /** Upper bound on verify-by-reload passes during a clearing run. */
  maxPasses: number;
}

/** Where a resolved value came from — reported by `youtube-cleanup config`. */
export interface ResolvedValue {
  value: string;
  source: string;
}

export type ConfigOverrides = Partial<Record<keyof typeof VAR_NAMES, string | undefined>>;

const VAR_NAMES = {
  cdpUrl: 'YOUTUBE_CLEANUP_CDP_URL',
  outputDir: 'YOUTUBE_CLEANUP_OUTPUT_DIR',
  maxScrolls: 'YOUTUBE_CLEANUP_MAX_SCROLLS',
  actionDelayMs: 'YOUTUBE_CLEANUP_ACTION_DELAY_MS',
  maxPasses: 'YOUTUBE_CLEANUP_MAX_PASSES',
} as const;

type ConfigKey = keyof typeof VAR_NAMES;

/**
 * Minimal `.env` reader: `KEY=value`, `export KEY=value`, `#` comments, and
 * single/double quoted values. Deliberately hand-rolled to keep the dependency
 * surface of a tool that drives a browser as small as possible.
 */
const parseEnvFile = (path: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (match === null) continue;
    const key = match[1] as string;
    let value = (match[2] as string).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip a trailing unquoted inline comment.
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value !== '') out[key] = value;
  }
  return out;
};

const readEnvFileIfPresent = (path: string): Record<string, string> => {
  if (!existsSync(path)) return {};
  try {
    return parseEnvFile(path);
  } catch (error) {
    throw new ConfigurationError(
      `Could not read env file at ${path}: ${(error as Error).message}`,
    );
  }
};

/**
 * The four-tier resolution chain, listed lowest to highest priority:
 *   1. shell environment
 *   2. ~/.tool-agents/youtube-cleanup/.env
 *   3. ./.env in the current working directory
 *   4. CLI flags
 *
 * There is no fifth tier of built-in defaults, by design.
 */
export const resolveAll = (overrides: ConfigOverrides = {}): Record<ConfigKey, ResolvedValue> => {
  ensureToolConfigDir();

  const toolEnvPath = resolve(toolConfigDir(), '.env');
  const localEnvPath = resolve(process.cwd(), '.env');

  const tiers: Array<{ source: string; values: Record<string, string | undefined> }> = [
    { source: 'shell environment', values: process.env },
    { source: toolEnvPath, values: readEnvFileIfPresent(toolEnvPath) },
    { source: localEnvPath, values: readEnvFileIfPresent(localEnvPath) },
  ];

  const resolved = {} as Record<ConfigKey, ResolvedValue>;
  const missing: string[] = [];

  for (const key of Object.keys(VAR_NAMES) as ConfigKey[]) {
    const varName = VAR_NAMES[key];
    let winner: ResolvedValue | undefined;

    for (const tier of tiers) {
      const candidate = tier.values[varName];
      if (candidate !== undefined && candidate.trim() !== '') {
        winner = { value: candidate.trim(), source: tier.source };
      }
    }

    const override = overrides[key];
    if (override !== undefined && String(override).trim() !== '') {
      winner = { value: String(override).trim(), source: 'CLI flag' };
    }

    if (winner === undefined) {
      missing.push(varName);
    } else {
      resolved[key] = winner;
    }
  }

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Missing required configuration: ${missing.join(', ')}.\n` +
        `  This tool defines no fallback defaults. Set each variable in one of:\n` +
        `    1. the shell environment\n` +
        `    2. ${toolEnvPath}\n` +
        `    3. ${localEnvPath}\n` +
        `    4. the matching CLI flag (see --help)\n` +
        `  Run \`${TOOL_NAME} config\` to see what is currently resolvable.`,
    );
  }

  return resolved;
};

const requirePositiveInteger = (raw: ResolvedValue, varName: string): number => {
  if (!/^\d+$/.test(raw.value)) {
    throw new ConfigurationError(
      `${varName} must be a non-negative integer, got "${raw.value}" (from ${raw.source}).`,
    );
  }
  return Number.parseInt(raw.value, 10);
};

export const loadConfig = (overrides: ConfigOverrides = {}): Config => {
  const resolved = resolveAll(overrides);

  const cdpRaw = resolved.cdpUrl.value;
  let cdpUrl: string;
  try {
    const parsed = new URL(cdpRaw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ws:') {
      throw new Error(`unsupported protocol "${parsed.protocol}"`);
    }
    cdpUrl = cdpRaw.replace(/\/+$/, '');
  } catch (error) {
    throw new ConfigurationError(
      `${VAR_NAMES.cdpUrl} must be a URL such as http://127.0.0.1:9222, got "${cdpRaw}" ` +
        `(from ${resolved.cdpUrl.source}): ${(error as Error).message}`,
    );
  }

  const outputRaw = resolved.outputDir.value.replace(/^~(?=$|\/)/, homedir());
  if (!isAbsolute(outputRaw)) {
    throw new ConfigurationError(
      `${VAR_NAMES.outputDir} must be an absolute path, got "${resolved.outputDir.value}" ` +
        `(from ${resolved.outputDir.source}).`,
    );
  }

  const maxScrolls = requirePositiveInteger(resolved.maxScrolls, VAR_NAMES.maxScrolls);
  const actionDelayMs = requirePositiveInteger(resolved.actionDelayMs, VAR_NAMES.actionDelayMs);
  const maxPasses = requirePositiveInteger(resolved.maxPasses, VAR_NAMES.maxPasses);
  if (maxPasses < 1) {
    throw new ConfigurationError(
      `${VAR_NAMES.maxPasses} must be at least 1, got "${resolved.maxPasses.value}" ` +
        `(from ${resolved.maxPasses.source}).`,
    );
  }

  return { cdpUrl, outputDir: outputRaw, maxScrolls, actionDelayMs, maxPasses };
};

/** The convention requires the tool to own its config folder at mode 0700. */
export const ensureToolConfigDir = (): void => {
  const dir = toolConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    log.debug(`created ${dir}`);
  }
};

export const configVarNames = VAR_NAMES;
