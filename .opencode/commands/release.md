---
description: Orchestrate the lockstep @byline/* release from changeset through npm publication, branch sync, tags, and GitHub release.
agent: build
---

Drive a complete lockstep release for the package names in `.changeset/config.json` `fixed[0]`. Treat `$ARGUMENTS` as an optional bump level (`patch`, `minor`, or `major`). Never hard-code the package count or list.

The workflow is resumable, but npm publication is irreversible. Stop for explicit approval immediately before running `./publish-packages.sh --yes`, and stop again to show the complete GitHub release notes before creating or editing the umbrella release.

## 1. Preflight

Before changing files or remotes:

1. Run `gh auth status` and `npm whoami`; stop if GitHub or npm authentication is unavailable.
2. Require an empty `git status --porcelain`. Do not sweep unrelated work into a release.
3. Record the current branch as `ORIGINAL_BRANCH`; releases normally land on `develop`. If currently on `main` or a feature branch, ask before continuing.
4. Run `git fetch origin`, verify local and remote `develop` and `main` exist, and use `git rev-list --left-right --count <branch>...origin/<branch>` to require `0 0` for both. Stop on divergence.
5. Read `PREV_VERSION` from `packages/core/package.json`.
6. Read the exact fixed package names from `.changeset/config.json`, map each name to its `packages/*/package.json`, and verify all currently equal `PREV_VERSION`.
7. Verify the prior package tag `@byline/core@<PREV_VERSION>` resolves; use it as the release-range anchor.

## 2. Choose the bump

- If `$ARGUMENTS` is exactly `patch`, `minor`, or `major`, use it.
- Otherwise ask one question with Patch (recommended), Minor, and Major choices.
- Compute the expected next semantic version now and record it as `EXPECTED_VERSION`.

## 3. Derive the changeset summary

Inspect:

```sh
git log --oneline "@byline/core@<PREV_VERSION>..HEAD"
```

Read relevant commit diffs when subjects are insufficient. Produce one or two concise, lowercase, past-tense lines for the changeset body:

- Lead with user-visible fixes/features; skip release commits, pure formatting, and routine dependency noise.
- Mention package names only when they clarify ownership.
- Do not ask the user to author this short summary unless the history is genuinely ambiguous.

## 4. Create and consume the changeset

1. Create `.changeset/release-<timestamp>.md`.
2. Generate its YAML frontmatter from every package in the current `fixed[0]`, assigning each the chosen bump level. Do not maintain a duplicated package list in this command.
3. Put the derived summary after the frontmatter.
4. Run `pnpm version-packages`.
5. Verify the changeset was consumed, every fixed package now has one identical version, and that version equals `EXPECTED_VERSION`. Record it as `NEXT_VERSION`; stop on any mismatch.

## 5. Format and commit the release

1. Run `pnpm lint`. If it exposes unrelated failures or modifies files unrelated to versioning/formatting, stop and show them.
2. Inspect `git status`, unstaged diff, and staged diff.
3. Stage explicitly: `.changeset/`, each fixed package's `package.json`, each fixed package's `CHANGELOG.md`, and only other files changed by this release operation. Do not use `git add -A`.
4. Commit exactly `chore(release): <NEXT_VERSION>` without skipping hooks.
5. Push the current branch normally.

## 6. Publication checkpoint

Show the user:

- `PREV_VERSION -> NEXT_VERSION`
- Release commit SHA
- Changeset summary
- Fixed package count and names
- Remaining irreversible/visible steps: npm publish and package tags, fast-forward `main`, umbrella tag, GitHub release

Wait for explicit approval. Do not infer approval from invoking this command.

## 7. Publish packages and package tags

Run:

```sh
./publish-packages.sh --yes
```

This is the authoritative publisher for passkey-only npm 2FA. It builds, uses `pnpm pack` to rewrite `workspace:*`, refuses workspace leaks, publishes with npm, and creates/pushes each per-package tag. Do not replace it with `pnpm release:npm`, `changeset publish`, or `git push --tags`.

If publication fails partway, stop and surface the output. The script is intentionally idempotent; after the cause is fixed, rerun it to finish missing packages/tags.

## 8. Fast-forward main

1. Checkout `main`.
2. Fast-forward only from `ORIGINAL_BRANCH`: `git merge --ff-only <ORIGINAL_BRANCH>`.
3. Stop and ask if a fast-forward is impossible; never force or silently create a merge release commit.
4. Push `main` and return to `ORIGINAL_BRANCH`.
5. Verify the release commit is reachable from `main`.

## 9. Prepare the umbrella GitHub release

Use `v<NEXT_VERSION>` as the umbrella tag and the release commit as its anchor.

Check idempotent state before acting:

- If a local or remote umbrella tag exists, verify it points to the anchor. Stop on divergence.
- Run `gh release view v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev`. If it exists, show its URL and ask whether to leave it, edit notes, or recreate it.

Build full release notes from conversation context, commits/diffs since the prior package tag, the new changelog section, and the tone of the previous GitHub release. Use these sections in order, omitting empty sections:

1. `## Highlights`
2. `## Bug Fixes`
3. `## Chores`
4. `## Migrations`
5. `## Breaking Changes`

Each bullet should explain the user-visible change, why it matters, and any consumer action. Lead package-specific bullets with bold code package names; use **monorepo** for cross-cutting work. Mark breaking behavior and migration steps explicitly.

Always end with:

```text
All other `@byline/*` packages bumped to `<NEXT_VERSION>` in lockstep with no behavioural changes this cycle.
```

Show the complete notes, version, and anchor SHA, then wait for explicit approval.

## 10. Create missing umbrella artifacts

Only after approval, perform the missing idempotent steps:

```sh
git tag v<NEXT_VERSION> <anchor-sha>
git push origin v<NEXT_VERSION>
gh release create v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev --title "v<NEXT_VERSION>" --notes-file <notes-file>
```

If editing an existing release was approved, use `gh release edit` instead. Report the final GitHub release URL and final branch/worktree status.

Never amend release commits, force-push, move existing package tags, bypass hooks, or publish without the checkpoint approval.
