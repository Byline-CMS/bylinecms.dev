---
name: create-pr
description: Open or update a GitHub pull request for the current branch. Pass an optional issue number or title hint.
allowed-tools: Bash, Read, Skill, AskUserQuestion
argument-hint: [optional issue number or title hint]
---

Invoke the `github-pr` skill (via the Skill tool) and follow it exactly to create
or update the pull request. Pass "$ARGUMENTS" through as the optional issue
number or title hint if provided.
