# CLAUDE.md

@AGENTS.md

## Claude Code workflows

The repository defines its slash commands in [.claude/commands/](.claude/commands/).

- `/commit` and `/create-pr` use the [git-commit](.claude/skills/git-commit/SKILL.md) and [github-pr](.claude/skills/github-pr/SKILL.md) skills. The [conventional commit rule](.claude/rules/conventional-commits.md) includes Byline's DCO requirements.
- `/document` uses the [writing-docs skill](.claude/skills/writing-docs/SKILL.md).
- `/lint-fix`, `/typecheck` and `/test` provide verification workflows. `/push` and `/release` have their own command instructions.
