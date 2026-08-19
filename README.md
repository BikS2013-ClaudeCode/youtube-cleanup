# youtube-cleanup

Removes watched **YouTube Shorts** from your YouTube watch history — and nothing else.

Regular videos are never touched. A history row counts as a Short only if its
link is `youtube.com/shorts/<id>`; duration is never used as a signal, so a short
regular video (a clip, teaser, or trailer) is never mistaken for a Short.

## Why it drives a browser

The YouTube Data API cannot delete watch history — the `watchHistory` playlist
was withdrawn from the API in 2016 and nothing replaced it. The only working
route is the `youtube.com/feed/history` UI, so this tool attaches to a Chrome you
are already signed in to and clicks the same "Remove from watch history" control
you would click yourself.

## Setup

### 1. Install

Two ways in, depending on whether you want the Claude Code skill or just the CLI.

**As a Claude Code plugin (recommended).** The repo is itself a marketplace:

```
/plugin marketplace add BikS2013-ClaudeCode/youtube-cleanup
/plugin install youtube-cleanup@biks2013-claudecode
```

Then just ask Claude to clean up your YouTube history — the
`youtube-history-cleanup` skill handles bootstrap, Chrome, and the run. The CLI
builds itself on first use.

**As a plain CLI:**

```bash
git clone https://github.com/BikS2013-ClaudeCode/youtube-cleanup.git
cd youtube-cleanup
npm install          # delegates to plugins/youtube-cleanup/cli
npm run build
node plugins/youtube-cleanup/cli/dist/cli.js --help
```

Everything below uses `youtube-cleanup` as shorthand for that `node ... cli.js`
invocation.

### 2. Start Chrome with remote debugging

The tool attaches to Chrome over the DevTools Protocol; it never launches or
closes your browser.

> **Chrome 136+ refuses to open a debugging port on your default profile.** This
> is deliberate hardening against session-cookie theft. A separate
> `--user-data-dir` is not a nicety here — without one the port silently never
> opens, and the tool fails with `ECONNREFUSED`.

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-debug-profile" \
  --no-first-run --no-default-browser-check
```

Use `open -na`, not the binary directly: LaunchServices keeps that instance
alive independently of your shell, whereas a backgrounded direct invocation dies
when the launching shell is torn down.

That profile starts signed out. Either **sign in to Google in that window once**
(it persists for later runs), or **carry your existing session across** — quit
Chrome completely first, since it locks the cookie database:

```bash
# with Chrome fully quit (Cmd+Q):
cp "$HOME/Library/Application Support/Google/Chrome/Local State" \
   "$HOME/.chrome-debug-profile/Local State"
cp "$HOME/Library/Application Support/Google/Chrome/Default/Cookies" \
   "$HOME/.chrome-debug-profile/Default/Cookies"
```

> That copy is a **working duplicate of your Google session**. Delete
> `~/.chrome-debug-profile` when you're done with it, and shut the debug Chrome
> down after a run — anything that can reach the CDP port can drive the browser
> as you. That is exactly what Chrome's default-profile restriction exists to
> prevent.

### 3. Configure

Every setting is required — the tool defines **no fallback defaults** and raises
a descriptive `ConfigurationError` if a value is missing from all four tiers.

| Variable | Meaning |
|---|---|
| `YOUTUBE_CLEANUP_CDP_URL` | DevTools endpoint, e.g. `http://127.0.0.1:9222` |
| `YOUTUBE_CLEANUP_OUTPUT_DIR` | Absolute directory for JSON/CSV manifests |
| `YOUTUBE_CLEANUP_MAX_SCROLLS` | How many lazy-load scrolls to perform |
| `YOUTUBE_CLEANUP_ACTION_DELAY_MS` | Pause between consecutive removals |
| `YOUTUBE_CLEANUP_MAX_PASSES` | Max verify-by-reload passes in a clearing run |

Resolution order, lowest to highest priority:

1. shell environment
2. `~/.tool-agents/youtube-cleanup/.env`
3. `./.env` in the current directory
4. CLI flags (`--cdp-url`, `--output-dir`, `--max-scrolls`, `--delay-ms`, `--max-passes`)

Fill in `~/.tool-agents/youtube-cleanup/.env` (already scaffolded, mode `0600`),
then check what resolved from where:

```bash
youtube-cleanup config
```

## Usage

### Verify the setup — deletes nothing

```bash
youtube-cleanup doctor
```

Walks the whole removal path without removing anything, and ends in a plain
`READY` / `NOT READY` verdict (exit code 1 when not ready). It checks, in order:

1. every config value resolves, and from which tier;
2. Chrome is reachable over CDP;
3. you are signed in and the history page loads;
4. history rows are recognised, and how many are Shorts;
5. the first Shorts expose the **"More actions"** control;
6. that menu really contains **"Remove from watch history"**, and that entry has
   the inner `.ytListItemViewModelTappable` element that actually receives the
   click.

Step 6 opens one menu and closes it again with Escape — the Remove entry is
never clicked. If your history has no Shorts, the same check runs against a
regular video row instead, since both share one removal path.

Run this after any YouTube layout change: it names the specific step that broke
rather than failing mid-deletion.

### Dry run — the default

```bash
youtube-cleanup
# or explicitly:
youtube-cleanup shorts
```

Scrolls the history feed, lists every Short it found, and writes a JSON + CSV
manifest. Nothing is deleted.

### Delete

```bash
youtube-cleanup shorts --apply
```

Prompts for confirmation, then removes each Short one at a time, waiting for
each row to disappear before moving to the next. Add `--yes` to skip the prompt
(required for non-interactive runs) and `--limit N` to cap how many are removed.

A cautious first real run:

```bash
youtube-cleanup shorts --apply --limit 5
```

### Options

```
--apply                 actually delete (default: dry run)
--limit <n>             act on at most N Shorts, newest first
--max-passes <n>        override YOUTUBE_CLEANUP_MAX_PASSES
-y, --yes               skip the confirmation prompt
--cdp-url <url>         override YOUTUBE_CLEANUP_CDP_URL
--output-dir <path>     override YOUTUBE_CLEANUP_OUTPUT_DIR
--max-scrolls <n>       override YOUTUBE_CLEANUP_MAX_SCROLLS
--delay-ms <n>          override YOUTUBE_CLEANUP_ACTION_DELAY_MS
-v, --verbose           per-step debug detail
```

## Manifests

Each run writes two files to `YOUTUBE_CLEANUP_OUTPUT_DIR`:

- `youtube-cleanup-<mode>-<timestamp>.json` — full record: config used, counts,
  every Short found, per-item removal outcome, and `entries`: every row seen in
  the scan, Shorts and regular alike. That last field is a baseline — diff two
  manifests to prove nothing outside Shorts was touched.
- `youtube-cleanup-<mode>-<timestamp>.csv` — one row per Short, for eyeballing
  in a spreadsheet.

The dry-run manifest is your record of what *would* go; the apply manifest is
your record of what actually went.

## Passes, and why one is not enough

Clearing runs in passes. Each pass removes every Short currently loaded, then
reloads and re-harvests — and because the feed is shorter afterwards, the reload
pulls in older history that was previously below the scroll horizon. So a pass
routinely *surfaces* new Shorts rather than finding fewer. The run ends when a
pass removes nothing.

On a history of ~600 entries this took 21 passes and about 20 minutes to reach
zero. If a run stops while Shorts remain, it hit `YOUTUBE_CLEANUP_MAX_PASSES`; run it
again or raise that ceiling.

## How much history it covers

YouTube loads history lazily. `YOUTUBE_CLEANUP_MAX_SCROLLS` bounds how far back
the tool walks — it stops early once two consecutive scrolls load nothing more,
and reports whether it reached the end. Raise the value to go deeper; run the
command repeatedly to work through a very long history.

## How removal actually works

Verified against the live history page, not assumed:

- History rows are **`yt-lockup-view-model`** elements. Shorts are different —
  they are tiles (`ytm-shorts-lockup-view-model-v2`) inside a horizontally
  scrolling **`ytd-reel-shelf-renderer`** carousel, not rows of their own.
- Neither has an inline "X" button. Each exposes a single **"More actions"**
  control whose dropdown contains a **"Remove from watch history"** entry.
- That entry's host element carries `role="presentation"`; the element that
  actually handles the tap is the inner `.ytListItemViewModelTappable`. Clicking
  the host does nothing.
- **Clicking Remove does not remove the tile.** YouTube shows a toast reading
  "All views of this video removed from history" and leaves the tile in the
  carousel. The entry is gone from history server-side, but the page will keep
  displaying it until reloaded.

That last point drives the whole control flow. Because the DOM cannot be trusted
to report success, the tool works in **verify-by-reload passes**: harvest the
feed, click Remove on every Short found, reload, re-harvest, and treat
*disappeared after reload* as the only proof of removal. Anything that survives
a reload is reported as failed, not silently counted as done. Passes repeat
while each one still removes something.

The page is loaded with `?hl=en` (non-persistent, so your account's language
preference is untouched) to keep the menu labels deterministic.

## Repository layout

```
.claude-plugin/marketplace.json     this repo is an installable marketplace
plugins/youtube-cleanup/
  .claude-plugin/plugin.json
  cli/                              the TypeScript CLI (source of truth)
  skills/youtube-history-cleanup/   the Claude Code skill
.claude/skills/                     symlink, so the skill works in this repo
docs/tools/youtube-cleanup.md       tool documentation
youtube-history-cleanup-docs/       skill development notes
```

The CLI lives inside the plugin deliberately: a marketplace install copies only
the plugin directory, so a plugin that referenced an external path would not
work anywhere else. The repository root delegates to it with npm `--prefix`
scripts rather than keeping a second copy.

## Caveats

- **Deletion is irreversible.** YouTube's own Undo toast is the only recovery,
  and it is gone within seconds. Dry-run first.
- The tool opens one new tab in your existing Chrome and closes it when done. It
  never closes your browser.
- YouTube can change its DOM at any time, and has already done so once during
  this tool's life. `doctor` is the canary: it names the exact step that broke
  (row recognition, the "More actions" trigger, the menu entry, or its inner
  tappable element) instead of failing mid-deletion.
- The debug Chrome profile holds a copy of your Google session while it exists.
  Shut the debug instance down after a run, and delete
  `~/.chrome-debug-profile` when you no longer need it.
