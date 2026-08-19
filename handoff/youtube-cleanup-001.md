# Session handoff — youtube-cleanup — 001

/ Date: 2026-08-19 / Working dir: `/Users/giorgosmarinos/.biks2013-configurations/youtube-cleanup`

## What this session did

Built a TypeScript CLI that removes watched YouTube **Shorts** from the user's
YouTube watch history, ran it against their real account, packaged it as a
Claude Code plugin with a skill, and published it publicly.

**Published:** https://github.com/BikS2013-ClaudeCode/youtube-cleanup
(public, MIT, 31 files, initial commit `dc5ee63` on `main`)

**Outcome against the live account:** 441 Shorts removed across 21
verify-by-reload passes. Final scan: 0 Shorts, regular videos untouched. Every
removal record is a `/shorts/` URL — audited, 0 exceptions.

Everything of substance is already written down in the repo. Do not re-derive it:

| Where | What |
|---|---|
| `README.md` | Setup, usage, passes, removal mechanism, caveats |
| `CLAUDE.md` | Layout, conventions, **"Hard-won facts about this domain"** |
| `docs/tools/youtube-cleanup.md` | Tool doc per the tool-conventions rule |
| `Issues - Pending Items.md` | Dependency vetting log + open items |
| `youtube-history-cleanup-docs/` | Skill design, decisions, test plan |
| `plugins/.../references/troubleshooting.md` | Symptom → diagnosis table |

## Read this before touching `cli/src/youtube.ts`

Four assumptions in the first implementation were wrong. They are recorded in
`CLAUDE.md` under "Hard-won facts", but the one that will bite hardest:

> **Clicking "Remove from watch history" does not remove the tile.** YouTube
> shows a toast and leaves it on screen. Removal is confirmed **only** by
> reloading and re-harvesting. Do not reintroduce an element-detachment check —
> that bug reported success on removals that never happened, and separately
> reported failure on ones that did.

## Current state

- Typecheck clean, build clean, `npm audit` 0 vulnerabilities.
- All five config settings enforced with no fallback defaults; each verified to
  raise + exit 1 when blanked in its supplying tier.
- `doctor` rewritten against the real DOM; returns READY on the live page.
- Tool-conventions audit (`tool-doc-config-architect`, audit mode): **zero
  findings** at every severity.
- Skill is registered and visible in-session via the `.claude/skills` symlink.

## Open items

1. **Skill instructions are unevaluated.** The `skill-creator` eval loop
   (with-skill vs baseline subagents, benchmark, viewer) was never run — the
   user had not asked for that scale. Three realistic prompts and candidate
   assertions are drafted in `youtube-history-cleanup-docs/test-plan.md`. The
   highest-value check: does the description **over-trigger** on unrelated
   YouTube requests ("summarise this YouTube link", "download this video")?
2. **GitHub has not detected the LICENSE** as MIT yet (`licenseInfo: null`).
   The file is present and standard; this is almost certainly indexing lag.
   Confirm on a later visit rather than editing the file.
3. **Marketplace install is unverified end to end.** Structure was validated
   programmatically and matches the user's working `nbg-ai` marketplace, but
   `/plugin marketplace add` is interactive-only so it could not be exercised
   from a tool call. Ask the user to run it once and report.
4. **`~/.chrome-debug-profile` still exists** on the user's machine and holds a
   copied, working duplicate of their Google session. They were told; they have
   not said whether to delete it. Do not delete it unprompted — it is what makes
   future runs skip the login.
5. **Unexplained-but-benign count drift.** Regular-video count moved 181 → 172
   → 174 across the session with no removal in between. Established as normal
   YouTube feed drift, not deletion. Scan manifests now record `entries` (every
   row seen) so any future question can be settled by diffing, not arguing.

## To run the tool again

Chrome must be attached and signed in. The bundled scripts handle it:

```bash
bash plugins/youtube-cleanup/skills/youtube-history-cleanup/scripts/chrome-debug.sh
node plugins/youtube-cleanup/cli/dist/cli.js doctor      # expect READY
node plugins/youtube-cleanup/cli/dist/cli.js shorts      # dry run, deletes nothing
```

Chrome 136+ refuses the debug port on the default profile — a separate
`--user-data-dir` is mandatory and the script already does this. Shut the debug
instance down afterwards (`chrome-debug.sh --stop`); while it runs, anything on
localhost can drive that browser as the signed-in user.

## Enforced rules that shaped this work

From the user's global CLAUDE.md and `~/.claude/rules` — all currently satisfied,
keep them satisfied:

- Tools are TypeScript, and tool docs/config **must** be created via
  `/tool-conventions scaffold` or the `tool-doc-config-architect` subagent —
  never by hand. Use `audit` mode after implementation changes.
- **No fallback defaults for configuration.** A missing setting raises. This is
  why `--max-passes` was promoted to `YOUTUBE_CLEANUP_MAX_PASSES` rather than
  defaulting to 12. If an exception is ever granted, it must be written to
  project memory *before* implementing it.
- Vet every new runtime dependency for advisories before adding it, and log the
  vetting date in `Issues - Pending Items.md`.
- No version-control operations unless explicitly requested. (The publish in
  this session was explicitly requested.)
- Skill work goes in `[skill-name]-docs/` — that folder holds skill-development
  material and nothing else.
- When locating code, report folder, file, symbol, and line number together.

## Suggested skills

- **`youtube-history-cleanup`** — the skill built this session. Invoke it for
  any further history cleanup rather than driving the CLI by hand; it encodes
  the safety ordering (scan → show → confirm → apply).
- **`skill-creator:skill-creator`** — for open item 1. It owns the eval loop:
  spawn with-skill and baseline runs, grade, `generate_review.py`, iterate. Also
  has the description-optimisation loop, which is the right tool for the
  over-triggering question.
- **`tool-conventions`** (`audit youtube-cleanup`) — re-run after any change to
  `cli/src/config.ts`, the CLI surface, or `docs/tools/youtube-cleanup.md`.
- **`github`** — for repo-side follow-ups (releases, topics, license badge).
- **`manage-marketplaces`** — if the user wants this plugin added to another
  marketplace or wants the marketplace repo restructured.

## No secrets in this document

No tokens, keys, or credentials are recorded here. Note for the next agent:
`~/.tool-agents/youtube-cleanup/.env` (mode 0600) and `~/.chrome-debug-profile`
contain sensitive material — never print, copy into the repo, or publish them.
