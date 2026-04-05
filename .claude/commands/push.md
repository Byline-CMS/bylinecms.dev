Push commits to the remote repository.

## Steps

1. Run `git status` to check for uncommitted changes. If there are any, warn the user and ask whether to proceed.
2. Determine the current branch and its upstream tracking branch. If no upstream is set, suggest setting one with `git push -u origin <branch>`.
3. Run `git log @{u}..HEAD --oneline` to show commits that will be pushed. If there are no new commits, inform the user and stop.
4. Show the commit list and ask the user to confirm the push.
5. Run `git push` to push the commits.
6. Report success or failure.
