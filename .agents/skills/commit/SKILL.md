---
name: commit
description: Review the current Git worktree, select one independently verifiable change, stage it safely, and create a conventional commit. Use when the user explicitly asks Codex to commit changes or invokes $commit, optionally with a commit-message hint.
---

# Commit changes

Create one intentional commit for the current worktree. Treat any text accompanying the invocation as a message hint, not as permission to ignore repository conventions or include unrelated changes.

## Workflow

1. Inspect `git status --short`, `git diff`, `git diff --cached`, and `git log --oneline -10`. Never use `-uall`.
2. Identify the files that form one independently verifiable change. Preserve unrelated tracked, staged, and untracked work.
3. Select a conventional subject matching recent history:
   - `feat(scope): ...` for a feature or significant enhancement
   - `fix(scope): ...` for a bug fix
   - `chore: ...` or `chore(deps): ...` for maintenance or dependency updates
   - `refactor: ...`, `docs: ...`, `test: ...`, `style: ...`, `ci: ...`, or `perf: ...` when appropriate
4. Use a scope only when the change is clearly confined to one area. Keep the subject concise and lowercase after the colon, prefer past tense, and omit a trailing period.
5. Stage specific files rather than `git add -A`. Never stage `.env` files, credentials, tokens, generated secrets, or unrelated changes.
6. Reinspect the staged diff. Run an appropriate focused verification if the change has not already been verified.
7. Commit with the conventional one-line subject. Do not skip hooks or signing.
8. Run `git status --short` and report the commit SHA, subject, verification performed, and any remaining changes.
