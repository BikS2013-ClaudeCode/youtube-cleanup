# youtube-history-cleanup — skill development docs

Material for developing the `youtube-history-cleanup` skill. Per the project
rule, this folder holds skill-development material only — no runtime code, no
tool documentation. The tool's own docs live in `docs/tools/youtube-cleanup.md`.

| Document | Contents |
|---|---|
| `design.md` | What the skill does, why it exists, and how it is packaged. |
| `decisions.md` | The design decisions taken and what was rejected. |
| `test-plan.md` | How to verify the skill, including the eval loop if run. |

The skill itself lives at
`plugins/youtube-cleanup/skills/youtube-history-cleanup/`, and is exposed for
project-level use through a symlink at `.claude/skills/youtube-history-cleanup`.
