# Troubleshooting

Read the failing symptom, not the nearest guess. Most of these were discovered
the hard way; the diagnosis matters more than the fix.

## `ECONNREFUSED` when attaching

Nothing is listening on the CDP port. Almost always one of:

1. **Chrome was started against the default profile.** Since Chrome 136 the
   debugging port is *refused* when `--user-data-dir` points at the default
   profile directory — deliberate hardening against session-cookie theft. Chrome
   starts normally and the port silently never opens. A separate
   `--user-data-dir` is mandatory.
2. **Chrome was launched from a shell that then exited.** A backgrounded direct
   binary invocation dies with its parent. Use `open -na`, which detaches via
   LaunchServices. `scripts/chrome-debug.sh` does this.
3. Genuinely not started yet.

Check with `curl -s http://127.0.0.1:9222/json/version`.

## "does not appear to be signed in to YouTube"

The debug profile is separate from the normal one and starts signed out. Either
sign in to Google in that window once, or copy the session across with
`scripts/chrome-debug.sh --copy-session` while Chrome is **fully quit** (it locks
the cookie database).

If you are certain the profile is signed in and this still fires, the page may
not have hydrated. The check already waits for the avatar or the history browse
element plus a settle delay; a very slow connection can still outrun it.

## `doctor` says NOT READY

It names the step. Each maps to a specific breakage:

| Step reported | Meaning |
|---|---|
| No history rows recognised | The item tags in `installHelpers()` no longer match. YouTube renamed or replaced its row components. |
| No "More actions" control on a row | The per-row menu trigger changed, or its accessible label is no longer matched by `MENU_RE`. |
| Menu has no "Remove from watch history" entry | The menu item text or component type changed. The tool looks for `yt-list-item-view-model`, `ytd-menu-service-item-renderer`, and `tp-yt-paper-item`. |
| Remove entry has no `.ytListItemViewModelTappable` | The entry's internal structure changed. This one matters: the entry host carries `role="presentation"` and ignores clicks, so without the inner tappable element removal silently does nothing. |

All four live in `cli/src/youtube.ts`. When fixing, verify against the live page
rather than reasoning about what the markup ought to be — every one of these
assumptions was wrong in the first implementation.

## The run reports removals but nothing disappears

This should be impossible now, and if it happens the verification has broken
rather than the removal. The tool confirms removal **only** by reloading and
re-harvesting; "the row vanished from the DOM" is explicitly not treated as
proof, because YouTube leaves Shorts tiles on screen after removing them from
history. If you are editing `clearShorts`, do not reintroduce a detachment check.

## The run stops with Shorts still remaining

It hit `YOUTUBE_CLEANUP_MAX_PASSES`. This is expected on a long history: each
pass shortens the feed, so the next reload pulls in older entries that were
below the scroll horizon, and pass counts grow accordingly. Re-run it, or raise
the ceiling. Re-running is always safe.

## `ConfigurationError` on a value that "is set"

The four-tier chain is shell env → `~/.tool-agents/youtube-cleanup/.env` →
`./.env` → CLI flags, lowest to highest. A blank value is treated as absent, so
an empty assignment in a higher tier does not mask a lower one — but a *populated*
higher tier does override. Run `youtube-cleanup config` to see the winning value
and which tier it came from.

There are no fallback defaults anywhere, by design: a missing setting raises
rather than silently doing something unintended to the user's history.

## Counts differ between two scans

YouTube's history row count drifts on its own — a 172 → 174 change with no
removal run in between has been observed. A small delta is not evidence of
deletion. Every scan manifest records `entries` (every row seen, Shorts and
regular alike); diff two manifests to settle it properly.
