# Design — youtube-history-cleanup skill

## Problem

Clearing Shorts out of a YouTube watch history is not a task a model can improvise
reliably, for two reasons discovered during implementation:

1. **No API exists.** The YouTube Data API's `watchHistory` playlist was withdrawn
   in 2016 with no delete endpoint since. Only the web UI can do it.
2. **The UI lies about success.** Clicking "Remove from watch history" leaves the
   Shorts tile on screen; YouTube only shows a toast. A model driving the page
   directly will conclude the removal failed — or, if it checks the wrong signal,
   that a removal succeeded when it did not.

A model given only browser tools will re-derive both of these the hard way, and
will probably get the second one wrong, because the obvious success check
(element detached) is the wrong one.

## Solution shape

The skill does not automate the page. It drives a bundled CLI that already
encodes the hard-won behaviour, and spends its instructions on the things a model
still has to get right: safety ordering, the Chrome attachment constraints, and
honest reporting.

```
plugins/youtube-cleanup/
├── .claude-plugin/plugin.json
├── cli/                              # the tool — bundled, not referenced
└── skills/youtube-history-cleanup/
    ├── SKILL.md
    ├── scripts/
    │   ├── bootstrap.sh              # idempotent install + build
    │   ├── init-config.sh            # seed the five required settings
    │   └── chrome-debug.sh           # start/stop/copy-session for debug Chrome
    └── references/
        ├── troubleshooting.md        # symptom -> diagnosis
        └── cli.md                    # full flag and config reference
```

## Progressive disclosure

- **Metadata** (name + description): always loaded. Written to over-trigger
  slightly, because the failure mode of not firing is that the model improvises
  browser automation and gets the verification wrong.
- **SKILL.md body** (~170 lines): the six-step workflow, the two non-obvious
  domain facts, and the safety ordering.
- **references/**: read only on failure or when a specific flag is needed. Keeps
  the common path cheap.

## Why the CLI is bundled rather than referenced

A marketplace install copies only the plugin directory. Referencing a globally
installed `youtube-cleanup`, or a sibling project path, would make the plugin
non-functional on any machine but this one. So `cli/` lives inside the plugin and
is the single source of truth; the repository root delegates to it via npm
`--prefix` scripts rather than keeping a second copy.

The cost is a one-time `npm install` + build on first use, handled by
`bootstrap.sh`. Measured cold-start: about 2 seconds with a warm npm cache.

## Scripts, not prose

Three operations were repeatedly error-prone when described in prose and left to
the model: bootstrapping the build, seeding config without clobbering existing
values, and launching Chrome with the flags that actually work. Each is now a
script. `chrome-debug.sh` in particular encodes the Chrome 136 profile
restriction, which is invisible in the failure mode — the port simply never
opens.
