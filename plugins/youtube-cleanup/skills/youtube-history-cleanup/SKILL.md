---
name: youtube-history-cleanup
description: Removes watched YouTube Shorts from the user's YouTube watch history, leaving regular videos untouched. Use this skill whenever the user wants to clean up, clear, prune, or tidy their YouTube history — and especially whenever Shorts, "youtube shorts", "my watch history", or "youtube history" come up in the context of removing or deleting things. Also use it when the user asks how many Shorts are in their history, wants to preview what would be deleted, or asks to re-run or schedule a history cleanup. Reach for this even if the user does not name the tool, says something vague like "get rid of all those stupid shorts I watched", or asks whether their history can be cleaned automatically.
---

# YouTube history cleanup

Removes YouTube Shorts from the user's watch history. Regular videos are never
touched.

Two things make this task unlike normal browser automation, and both are the
reason this skill exists rather than you driving the page yourself:

1. **The YouTube Data API cannot do this at all.** The `watchHistory` playlist
   was withdrawn from the API in 2016 and no delete endpoint replaced it. The
   only route is the `youtube.com/feed/history` UI.
2. **Clicking "Remove from watch history" does not remove the row.** YouTube
   shows a toast and leaves the tile on screen. Success can only be confirmed by
   reloading. Any approach that trusts the DOM will report false failures — and,
   worse, false successes.

The bundled `youtube-cleanup` CLI already handles both. Drive the CLI; do not
try to automate the page directly.

## Default behaviour: scan, show, then ask

Deletion is irreversible and YouTube's own Undo toast expires in seconds, so
unless the user has clearly already told you to just clear everything, run a
dry-run scan first, show what was found, and get confirmation before applying.
A user who says "clean up my shorts" usually still wants to see the count before
441 entries disappear.

## Step 1 — Locate and bootstrap the CLI

The CLI lives inside this plugin at `${CLAUDE_PLUGIN_ROOT}/cli`. It needs a
one-time `npm install` + build. The bootstrap script is idempotent, so run it
whenever you are unsure of the state:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/youtube-history-cleanup/scripts/bootstrap.sh"
```

It prints `READY <path-to-dist/cli.js>` on success. Use that path for every
later command. If `CLAUDE_PLUGIN_ROOT` is unset (the skill was copied somewhere
manually), resolve the plugin root relative to this SKILL.md instead.

## Step 2 — Make sure configuration exists

The tool has **five required settings and no fallback defaults** — a missing one
is an error, by design. Check what resolves:

```bash
node "$CLI" config
```

If it raises `ConfigurationError`, seed the config file rather than passing
flags every time:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/youtube-history-cleanup/scripts/init-config.sh"
```

That writes `~/.tool-agents/youtube-cleanup/.env` (mode 0600) with working
values, without overwriting anything already set.

## Step 3 — Get an attached, signed-in Chrome

The tool attaches to a Chrome the user starts with `--remote-debugging-port`; it
never launches or closes their normal browser.

**Since Chrome 136 the debugging port is refused on the default profile
directory.** This is deliberate anti-cookie-theft hardening. A separate
`--user-data-dir` is mandatory — without one the port silently never opens and
the tool fails with `ECONNREFUSED`. The helper handles this:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/youtube-history-cleanup/scripts/chrome-debug.sh"
```

It starts a debug Chrome on port 9222 with a dedicated profile and waits for the
port. That profile starts **signed out**. The user must either sign in to Google
in that window once, or carry their existing session across — the script prints
both options, and `--copy-session` performs the copy when Chrome is fully quit.

Tell the user plainly that the copied session is a working duplicate of their
Google login, and that the debug port lets anything on localhost drive the
browser as them. Offer to shut the debug instance down when the run finishes.

Then confirm the whole path end to end without deleting anything:

```bash
node "$CLI" doctor
```

`doctor` ends in `READY` or `NOT READY` and exits non-zero when not ready. If it
says NOT READY, it names the exact step that broke — read
`references/troubleshooting.md` before guessing.

## Step 4 — Scan, and show what you found

```bash
node "$CLI" shorts
```

This deletes nothing. Report to the user:

- how many Shorts were found, and how many regular videos were left alone
- whether the scan reached the end of their history
- the manifest paths, so they have a record

If zero Shorts were found, say so and stop. There is nothing to confirm.

## Step 5 — Confirm, then clear

Get explicit confirmation, then:

```bash
node "$CLI" shorts --apply --yes
```

`--yes` skips the CLI's own prompt because you have already obtained
confirmation from the user; do not use it before they have agreed. For a
cautious first run on an unfamiliar account, `--limit 5` removes only the five
newest and is worth offering.

**Expect this to take a while and to need several passes.** Clearing works in
verify-by-reload passes: remove everything loaded, reload, re-verify. Because
removing entries shortens the feed, each reload pulls in older history that was
previously below the scroll horizon — so a pass routinely surfaces *more* Shorts
than the one before it. A history of ~600 entries took 21 passes and about 20
minutes. Run it in the background and report progress rather than blocking.

If the run stops while Shorts remain, it hit `YOUTUBE_CLEANUP_MAX_PASSES`. Run
it again or raise that ceiling; the tool is safe to re-run.

## Step 6 — Verify and tidy up

Re-scan to confirm, and report the real numbers:

```bash
node "$CLI" shorts
```

The manifests in the output directory record every removal, and every scan
records `entries` — every row seen, Shorts and regular alike. If the user ever
doubts that only Shorts were touched, diff two manifests rather than
speculating. Note that YouTube's own row count drifts between scans with no
removal taking place, so a small delta is not evidence of deletion.

Offer to shut down the debug Chrome:

```bash
pkill -f "user-data-dir=$HOME/.chrome-debug-profile"
```

## Reporting honestly

The tool distinguishes `removed`, `failed`, and `skipped`, and confirms removal
only by reload. Pass that precision through to the user — if 12 entries failed,
say 12 failed and why, rather than rounding up to success. The whole design
exists because an earlier version reported success on removals that never
happened.

## Reference

- `references/troubleshooting.md` — what each `doctor` failure means, the
  Chrome 136 profile restriction, sign-in problems, and what to check when
  YouTube changes its markup. Read it whenever a command fails rather than
  improvising.
- `references/cli.md` — full command and flag reference, the five configuration
  variables, and the four-tier resolution order.
