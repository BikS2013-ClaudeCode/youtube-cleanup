# Test plan — youtube-history-cleanup skill

## Verified so far

| Check | Result |
|---|---|
| Cold bootstrap from wiped `node_modules` + `dist` | READY in ~2s, CLI runnable |
| Bootstrap invoked through the `.claude/skills` symlink | Resolves the real plugin root |
| `plugin.json` and `marketplace.json` parse as JSON | Pass |
| All three bundled scripts pass `bash -n` | Pass |
| `config` resolves all five settings | Pass |
| Every setting raises when blanked in its supplying tier | Pass, exit 1 |
| `doctor` against a live signed-in Chrome | READY, menu entry and tappable found |
| Full clear against a real history | 441 Shorts removed, 0 regular videos touched |

## Not yet done — skill-level evals

The skill's *instructions* have not been evaluated the way `skill-creator`
prescribes: run realistic prompts against a subagent with and without the skill,
compare outputs, and iterate on the wording.

Proposed prompts, all things a user would plausibly type:

1. "my youtube history is full of shorts i watched by accident, can you get rid
   of them but leave my actual videos alone"
2. "how many youtube shorts are sitting in my watch history right now?"
3. "clean up my youtube history" — deliberately ambiguous between Shorts-only
   and everything, to check the skill clarifies rather than assuming.

Useful assertions:

- Ran a dry-run scan before any `--apply`.
- Reported the Shorts count and the untouched regular-video count.
- Obtained confirmation before deleting (prompt 1 and 3).
- Did not attempt to drive youtube.com with browser tools directly.
- Did not claim success without a post-reload verification.

Worth running before publishing a v1.1, particularly to check whether the
description over-triggers on unrelated YouTube requests such as "download this
YouTube video" or "summarise this YouTube link".
