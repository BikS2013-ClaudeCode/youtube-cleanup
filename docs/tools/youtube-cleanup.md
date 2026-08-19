<youtubeCleanup>
    <objective>
        Removes YouTube Shorts entries from the signed-in user's YouTube watch history,
        and nothing else. The tool attaches over the Chrome DevTools Protocol (CDP) to a
        Chrome instance the user has already started with --remote-debugging-port,
        reusing their existing logged-in Google session. It navigates to
        youtube.com/feed/history, harvests history entries, classifies an entry as a
        Short strictly by its /shorts/<id> link URL, and removes only those entries
        through each row's "More actions" menu. The tool is dry-run by default and only
        performs deletions when invoked with --apply.
    </objective>
    <command>
        youtube-cleanup
    </command>
    <info>
        ## Description

        youtube-cleanup is a TypeScript CLI that cleans YouTube Shorts entries out of
        a user's watch history without requiring OAuth or API credentials. The YouTube
        Data API cannot do this at all: the watchHistory playlist was withdrawn from
        the API in 2016 and no delete endpoint replaced it. The tool therefore attaches
        to an already-running, already logged-in Chrome over CDP and drives the
        youtube.com/feed/history page the way a human would.

        Classification is by link URL only. A row is a Short if and only if its link is
        /shorts/<id>. Duration is never consulted, so a short regular video (a clip,
        teaser, or trailer) is never mistaken for a Short. Regular video watches are
        left untouched.

        The tool never deletes on a plain invocation. By default it performs a dry run:
        it scans history, classifies entries, and writes a manifest of what it *would*
        remove. Pass --apply to actually perform the removals; --apply also prompts for
        confirmation unless -y/--yes is given.

        ## Subcommands

        | Subcommand | Description |
        |---|---|
        | shorts | Find Shorts in watch history and, with --apply, remove them. This is the default subcommand, so `youtube-cleanup` alone runs a dry-run scan. |
        | doctor | Non-destructive end-to-end check of the removal path; ends in a READY / NOT READY verdict and exits 1 when NOT READY. Deletes nothing. |
        | config | Show each configuration value and which tier of the resolution chain it came from. |

        ## Prerequisites

        Chrome must already be running with remote debugging enabled, signed in to the
        Google account whose history should be cleaned.

        IMPORTANT — since Chrome 136, Chrome REFUSES to open a remote-debugging port
        when it is pointed at the default profile directory. This is a deliberate
        hardening measure against session-cookie theft. A separate --user-data-dir is
        therefore mandatory; a bare `--remote-debugging-port` against the normal
        profile silently fails to open the port.

            open -na "Google Chrome" --args \
              --remote-debugging-port=9222 \
              --user-data-dir="$HOME/.chrome-debug-profile" \
              --no-first-run --no-default-browser-check

        Use `open -na` rather than invoking the binary directly: LaunchServices keeps
        the instance alive independently of the launching shell, whereas a backgrounded
        direct invocation dies when its parent shell is torn down.

        The separate profile starts signed out. Either sign in to Google in that window
        once (the profile persists for later runs), or carry the existing session over
        by copying the session state while Chrome is fully quit:

            cp "$HOME/Library/Application Support/Google/Chrome/Local State" \
               "$HOME/.chrome-debug-profile/Local State"
            cp "$HOME/Library/Application Support/Google/Chrome/Default/Cookies" \
               "$HOME/.chrome-debug-profile/Default/Cookies"

        Treat that copy as sensitive: it is a working duplicate of the user's Google
        session. Remove ~/.chrome-debug-profile when it is no longer needed, and shut
        the debug instance down after a run — anything able to reach the CDP port can
        drive the browser as the signed-in user.

        ## Command-line parameters

        | Flag | Description |
        |---|---|
        | --apply | Perform actual removals. Without it the tool runs dry: it scans and reports but clicks nothing. |
        | --limit <n> | Act on at most N Shorts, newest first. Useful for a cautious first run. |
        | --max-passes <n> | Overrides YOUTUBE_CLEANUP_MAX_PASSES for this invocation. |
        | -y, --yes | Skip the interactive confirmation prompt required by --apply. Mandatory for non-interactive runs, which otherwise raise rather than deleting unconfirmed. |
        | --cdp-url <url> | Overrides YOUTUBE_CLEANUP_CDP_URL for this invocation. Highest-priority source per the config resolution chain. |
        | --output-dir <path> | Overrides YOUTUBE_CLEANUP_OUTPUT_DIR for this invocation. |
        | --max-scrolls <n> | Overrides YOUTUBE_CLEANUP_MAX_SCROLLS for this invocation. |
        | --delay-ms <n> | Overrides YOUTUBE_CLEANUP_ACTION_DELAY_MS for this invocation. |
        | -v, --verbose | Print per-step debug detail. |
        | -V, --version | Print the version and exit. |
        | -h, --help | Print usage information and exit. |

        ## Configuration

        This tool is not LLM-enabled and defines no LLM provider environment
        variables. It requires the following configuration variables, each of which
        MUST be supplied by the environment or a CLI flag. There are no fallback
        default values for any of them — if a required variable is missing at
        startup, the tool raises ConfigurationError and exits with status 1 rather
        than substituting a default. Values that are present but malformed (a
        non-integer scroll count, a relative output path, an unparseable URL) raise
        the same way.

        | Variable | Purpose |
        |---|---|
        | YOUTUBE_CLEANUP_CDP_URL | Chrome DevTools Protocol endpoint of the already-running Chrome instance to attach to (e.g. http://127.0.0.1:9222). |
        | YOUTUBE_CLEANUP_OUTPUT_DIR | Absolute directory where run manifests (JSON and CSV records of what was found and what was removed) are written. |
        | YOUTUBE_CLEANUP_MAX_SCROLLS | Maximum number of lazy-load scroll iterations performed while harvesting the history feed, bounding how far back in history the tool walks. |
        | YOUTUBE_CLEANUP_ACTION_DELAY_MS | Delay in milliseconds inserted between consecutive removal actions, to avoid UI desync and server-side rate limiting. |
        | YOUTUBE_CLEANUP_MAX_PASSES | Maximum number of verify-by-reload passes during a clearing run. A long history needs many passes; the run also stops early once a pass removes nothing. |

        Configuration is resolved via a four-tier chain, lowest to highest priority:
          1. Shell-registered environment variables (process.env)
          2. ~/.tool-agents/youtube-cleanup/.env
          3. Local .env in the current working directory
          4. CLI flags (always win)

        `youtube-cleanup config` prints each resolved value together with the tier it
        came from. The tool checks for ~/.tool-agents/youtube-cleanup/ on startup and
        creates it (mode 0700) if missing; the .env inside it is expected at mode 0600.

        ## How removal works

        Verified against the live page, not assumed. These details are load-bearing and
        were each wrong in the first implementation:

        - History rows are yt-lockup-view-model elements. Shorts are NOT rows: they are
          ytm-shorts-lockup-view-model-v2 tiles inside a horizontally scrolling
          ytd-reel-shelf-renderer carousel.
        - Neither exposes an inline remove "X". Each has a single "More actions"
          control whose dropdown contains a "Remove from watch history" entry.
        - That entry's host element carries role="presentation" and ignores clicks. The
          element that actually receives the tap is the inner
          .ytListItemViewModelTappable.
        - Clicking Remove does NOT remove the tile. YouTube shows a toast reading
          "All views of this video removed from history" and leaves the tile on screen.
          The entry is gone server-side, but the DOM keeps displaying it until reload.

        Because the DOM cannot be trusted to report success, clearing runs in
        verify-by-reload passes: harvest the feed, click Remove on every Short found,
        reload, re-harvest, and treat "disappeared after reload" as the only proof of
        removal. Anything surviving a reload is reported failed, never silently counted
        as done. Passes repeat while each one still removes something, up to
        --max-passes.

        A pass routinely surfaces MORE Shorts than the one before it: removing entries
        shortens the feed, so the reload pulls in older history that was previously
        below the scroll horizon. A history of roughly 600 entries took 21 passes and
        about 20 minutes to reach zero.

        The page is loaded with ?hl=en (non-persistent, so the account's saved language
        preference is untouched) to keep menu labels deterministic.

        ## Manifests

        Every run writes two files to YOUTUBE_CLEANUP_OUTPUT_DIR:

        - youtube-cleanup-<mode>-<timestamp>.json — config used, summary counts, every
          Short found, per-item removal outcome, and `entries`: every row seen in the
          scan, Shorts and regular alike. That last field is a baseline; diffing two
          manifests proves nothing outside Shorts was touched.
        - youtube-cleanup-<mode>-<timestamp>.csv — one row per Short, for review in a
          spreadsheet.

        Note that YouTube's own row count drifts between scans without any removal
        taking place, so a small difference between two scans is not by itself evidence
        of deletion.

        ## Examples

        Check the setup end to end without deleting anything:
            youtube-cleanup doctor

        Show where each configuration value resolves from:
            youtube-cleanup config

        Dry run against the resolved config (reports what would be removed, deletes
        nothing):
            youtube-cleanup

        Dry run with an explicit CDP endpoint and output directory:
            youtube-cleanup --cdp-url http://127.0.0.1:9222 --output-dir /Users/me/youtube-cleanup-runs

        Cautious first real run — remove only the five newest Shorts, after confirming:
            youtube-cleanup shorts --apply --limit 5

        Remove every Short, unattended, allowing a long history to converge:
            youtube-cleanup shorts --apply --yes --max-passes 60   # or set YOUTUBE_CLEANUP_MAX_PASSES

        Remove with a slower per-action delay to avoid rate limiting:
            youtube-cleanup shorts --apply --delay-ms 1500

        Limit how far back into history the tool scrolls before stopping:
            youtube-cleanup --max-scrolls 40
    </info>
</youtubeCleanup>
