# Decisions — youtube-history-cleanup skill

## Taken

**Bundle the CLI source, bootstrap on first use.**
Alternatives were vendoring `node_modules` + `dist` (tens of MB, and pins
`playwright-core` so security updates need a re-publish) or requiring a global
install (not self-contained; fails on a fresh machine). Bundling source costs one
network fetch and keeps the plugin honest about its dependency versions.

**Scan and confirm before deleting, by default.**
Deletion is irreversible and YouTube's Undo toast expires in seconds. The CLI
already defaults to dry-run; the skill mirrors that rather than fighting it. The
skill passes `--yes` only after the user has confirmed, so the CLI's own prompt
never blocks a non-interactive run while still never deleting unconfirmed.

**Single source of truth for the skill, symlinked for project-level use.**
`.claude/skills/youtube-history-cleanup` is a symlink into the plugin. Two real
copies would drift. This forced `bootstrap.sh` to resolve its path physically
(`cd -P` / `pwd -P`), since bash's default logical path resolution would compute
the plugin root through the symlink and land in `.claude/`.

**Marketplace-ready in-repo, published as a repository.**
`.claude-plugin/marketplace.json` at the repository root makes the repo itself
installable as a marketplace, following the same layout as the user's existing
marketplaces (`.claude-plugin/marketplace.json` → `plugins/<name>/`).

## Rejected

**Having the skill drive the page directly with browser tools.**
This is the whole reason the tool exists. The verification signal is
counter-intuitive: removal must be confirmed by reloading, never by the element
disappearing. A skill that handed a model browser tools and good intentions would
reproduce the original bug.

**A `commands/` slash command in addition to the skill.**
The skill's description covers the invocation phrasings a slash command would,
and a command would duplicate the workflow. Can be added later if the user wants
a fixed `/youtube-cleanup` entry point.

**Documenting a default for `--max-passes`.**
It was promoted to the required setting `YOUTUBE_CLEANUP_MAX_PASSES` to satisfy
the project's no-fallback-defaults rule, so the skill documents the variable
rather than a hardcoded number.
