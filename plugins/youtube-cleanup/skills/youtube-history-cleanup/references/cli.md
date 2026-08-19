# CLI reference

Invoke as `node <plugin>/cli/dist/cli.js <subcommand>`.

## Subcommands

| Subcommand | Purpose |
|---|---|
| `shorts` | Find Shorts and, with `--apply`, remove them. Default subcommand. |
| `doctor` | Non-destructive end-to-end check; READY / NOT READY, exits 1 when not ready. |
| `config` | Show each setting and the tier it resolved from. |

## Flags on `shorts`

| Flag | Effect |
|---|---|
| `--apply` | Actually delete. Without it the run is a dry scan. |
| `--limit <n>` | Act on at most N Shorts, newest first. |
| `--max-passes <n>` | Override `YOUTUBE_CLEANUP_MAX_PASSES`. |
| `-y, --yes` | Skip the confirmation prompt. Required for non-interactive runs, which otherwise raise rather than delete unconfirmed. |
| `--cdp-url <url>` | Override `YOUTUBE_CLEANUP_CDP_URL`. |
| `--output-dir <path>` | Override `YOUTUBE_CLEANUP_OUTPUT_DIR`. |
| `--max-scrolls <n>` | Override `YOUTUBE_CLEANUP_MAX_SCROLLS`. |
| `--delay-ms <n>` | Override `YOUTUBE_CLEANUP_ACTION_DELAY_MS`. |
| `-v, --verbose` | Per-step debug detail. |

`--cdp-url`, `--output-dir`, `--max-scrolls`, `--delay-ms` also apply to
`doctor` and `config`.

## Configuration

Five required variables, no fallback defaults. A missing **or malformed** value
raises `ConfigurationError` and exits 1.

| Variable | Purpose |
|---|---|
| `YOUTUBE_CLEANUP_CDP_URL` | DevTools endpoint, e.g. `http://127.0.0.1:9222`. |
| `YOUTUBE_CLEANUP_OUTPUT_DIR` | Absolute directory for JSON/CSV manifests. |
| `YOUTUBE_CLEANUP_MAX_SCROLLS` | Lazy-load scroll iterations per harvest. |
| `YOUTUBE_CLEANUP_ACTION_DELAY_MS` | Pause between consecutive removals. |
| `YOUTUBE_CLEANUP_MAX_PASSES` | Max verify-by-reload passes per clearing run. |

Resolution order, lowest to highest priority:

1. shell environment
2. `~/.tool-agents/youtube-cleanup/.env` (mode 0600, folder 0700)
3. `./.env` in the working directory
4. CLI flags

## Manifests

Each run writes to `YOUTUBE_CLEANUP_OUTPUT_DIR`:

- `youtube-cleanup-<mode>-<timestamp>.json` — config used, summary counts, every
  Short found, per-item outcome, and `entries`: every row seen in the scan.
- `youtube-cleanup-<mode>-<timestamp>.csv` — one row per Short.

Outcomes are `removed`, `failed`, or `skipped`. `removed` means the entry was
absent after a reload — not merely that a click was issued.
