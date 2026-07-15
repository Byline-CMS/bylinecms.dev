---
name: push
description: Review and safely push local commits from the current Git branch to its upstream. Use when the user explicitly asks Codex to push commits or invokes $push; require confirmation after showing exactly what will be pushed.
---

# Push commits

Push the current branch without rewriting remote history.

## Workflow

1. Inspect `git status --short --branch`.
2. If tracked, staged, or untracked changes remain, show them and ask whether pushing the existing commits is still intended. Do not include those changes automatically.
3. Determine the current branch and its upstream.
   - If an upstream exists, show commits with `git log @{u}..HEAD --oneline`.
   - If no upstream exists, propose `git push -u origin <branch>` and show the local commits that would be introduced remotely.
4. If there are no commits to push, report that and stop.
5. Show the branch, remote destination, and complete outgoing commit list. Wait for explicit confirmation.
6. Run a normal `git push`, or the approved `git push -u origin <branch>` form. Never force-push.
7. Report the pushed commit range and remote branch, or surface any failure verbatim.
