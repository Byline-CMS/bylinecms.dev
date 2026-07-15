---
description: Review and push local commits to the current branch's upstream after explicit confirmation.
agent: build
---

Push the current branch safely.

1. Inspect `git status --short --branch`. If tracked or untracked changes remain, show them and ask whether pushing existing commits is still intended.
2. Determine the current branch and upstream. If there is no upstream, propose `git push -u origin <branch>`.
3. Show commits not yet upstream with `git log @{u}..HEAD --oneline`. If there are none, stop.
4. Ask for explicit confirmation after showing the branch, remote, and commit list.
5. Run a normal `git push` (or the approved `-u` form). Never force-push.
6. Report the pushed range and remote branch, or surface the failure verbatim.
