---
name: commit
description: Stage and commit changes using conventional commit format. Pass an optional message hint.
allowed-tools: Bash, Skill
argument-hint: [optional message hint]
---

Invoke the `git-commit` skill (via the Skill tool) and follow it exactly to create
the commit. Pass "$ARGUMENTS" through as the optional message hint if provided.
