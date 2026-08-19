# youtube-cleanup

A TypeScript CLI that removes watched YouTube **Shorts** from the signed-in
user's YouTube watch history — and nothing else.

## Why browser automation, not the API

The YouTube Data API cannot touch watch history. The `watchHistory` playlist was
removed from the API in 2016 and no delete endpoint replaced it. Driving the
`youtube.com/feed/history` UI is the only route.

## Tools

- **youtube-cleanup** — TypeScript CLI that removes YouTube Shorts entries from the signed-in user's YouTube watch history by attaching over CDP to an already-running, logged-in Chrome instance; dry-run by default, deletes only with `--apply`. Subcommands: `shorts` (default), `doctor` (non-destructive READY/NOT READY check), `config`. See `docs/tools/youtube-cleanup.md`.

## Layout

The CLI is at `plugins/youtube-cleanup/cli/` — inside the plugin, not at the
repo root, because a marketplace install copies only the plugin directory. Build
with `npm run build` from the root (it delegates via `--prefix`).

The skill is at `plugins/youtube-cleanup/skills/youtube-history-cleanup/`, with
`.claude/skills/youtube-history-cleanup` symlinked to it so it also works as a
project-level skill here. Edit the plugin copy; the symlink is not a second
source. Skill development notes belong in `youtube-history-cleanup-docs/`.

## Conventions in force here

- Configuration resolves through four tiers, lowest to highest priority:
  shell env → `~/.tool-agents/youtube-cleanup/.env` → local `./.env` → CLI flags.
- **No fallback defaults for configuration.** All five settings
  (`YOUTUBE_CLEANUP_CDP_URL`, `_OUTPUT_DIR`, `_MAX_SCROLLS`, `_ACTION_DELAY_MS`,
  `_MAX_PASSES`) raise `ConfigurationError` when absent from all four tiers, and
  raise again when present but malformed. See `src/config.ts`. Operational
  bounds belong in this set rather than as in-code defaults — that is why
  `--max-passes` is backed by a required variable rather than defaulting to 12.
- Shorts are identified **only** by a `/shorts/<id>` link on the history row.
  Duration is never used, so a short regular video is never mistaken for a Short.

## Hard-won facts about this domain

Each of these was wrong in the first implementation and cost a debugging cycle.
Do not "simplify" them away without re-verifying against the live page.

- History rows are `yt-lockup-view-model`; Shorts are `ytm-shorts-lockup-view-model-v2`
  tiles inside a `ytd-reel-shelf-renderer` carousel, not rows of their own.
- There is no inline remove "X" — removal goes through the row's "More actions"
  menu, whose entry host is `role="presentation"` and ignores clicks. The tap
  target is the inner `.ytListItemViewModelTappable`.
- **Clicking Remove does not remove the tile.** Success can only be confirmed by
  reloading, which is why `clearShorts` in `src/youtube.ts` verifies by reload
  and never by element detachment.
- Chrome 136+ refuses `--remote-debugging-port` on the default profile
  directory, so a separate `--user-data-dir` is mandatory.
- YouTube's history row count drifts between scans with no removal taking place;
  a small delta is not evidence of deletion. Manifests record every row seen
  (`entries`) so runs can be diffed properly.
