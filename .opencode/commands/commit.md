---
description: Stage and commit related changes using this repository's conventional commit style; optional arguments are a message hint.
agent: build
---

Create a git commit for the current worktree. Treat `$ARGUMENTS` as an optional message hint, not a literal message that overrides repository conventions.

1. Inspect `git status --short` (never use `-uall`), `git diff`, `git diff --cached`, and `git log --oneline -10`.
2. Identify the files that form one independently verifiable change. Do not sweep unrelated worktree changes into the commit.
3. Use the conventional style in recent history: `feat(scope): ...`, `fix(scope): ...`, `chore(deps): ...`, `refactor: ...`, `docs: ...`, `test: ...`, `style: ...`, `ci: ...`, or `perf: ...`.
4. Use a scope only when the change is clearly confined to one area. Keep the subject lowercase after the colon, concise, preferably past tense, and without a trailing period.
5. Stage specific files rather than `git add -A`. Never stage `.env` files, credentials, tokens, generated secrets, or unrelated changes.
6. DO NOT create a co-authored commit or include any co-authored by Claude or co-authored by any other AI agent or tool in any commit messages.
7. Reinspect the staged diff and run an appropriate focused verification if the work has not already been verified.
8. Commit with a one-line conventional message. Do not skip hooks or signing.
9. Run `git status --short` and report the commit SHA, subject, verification, and any remaining changes.
