---
name: release
description: Orchestrate the guarded, resumable lockstep release of the Byline monorepo's @byline/* packages, from changeset and version commit through npm publication, branch synchronization, tags, and the umbrella GitHub release. Use only when the user explicitly invokes $release, optionally with patch, minor, or major.
---

# Release Byline

Drive a complete lockstep release for the package names in `.changeset/config.json` `fixed[0]`. Treat any accompanying `patch`, `minor`, or `major` as the requested bump. Never hard-code the package count or list.

The workflow is resumable, but npm publication is irreversible. Require explicit approval immediately before running `./publish-packages.sh --yes`, and require a second approval after showing the complete umbrella GitHub release notes.

## 1. Preflight

Before changing files or remotes:

1. Run `gh auth status` and `npm whoami`; stop if GitHub or npm authentication is unavailable.
2. Require an empty `git status --porcelain`. Do not sweep unrelated work into a release.
3. Record the current branch as `ORIGINAL_BRANCH`. Releases normally land on `develop`; if currently on `main` or a feature branch, ask before continuing.
4. Run `git fetch origin`. Verify local and remote `develop` and `main` exist, then use `git rev-list --left-right --count <branch>...origin/<branch>` to require `0 0` for both. Stop on divergence.
5. Read `PREV_VERSION` from `packages/core/package.json`.
6. Read the exact fixed package names from `.changeset/config.json`, map each to its `packages/*/package.json`, and verify every current version equals `PREV_VERSION`.
7. Verify `@byline/core@<PREV_VERSION>` resolves and use it as the release-range anchor.

## 2. Choose the bump

- Use an explicitly supplied `patch`, `minor`, or `major` value.
- Otherwise ask the user to choose Patch (recommended), Minor, or Major.
- Compute the expected next semantic version and record it as `EXPECTED_VERSION`.

## 3. Derive the changeset summary

Inspect:

```sh
git log --oneline "@byline/core@<PREV_VERSION>..HEAD"
```

Read relevant commit diffs when subjects are insufficient. Produce one or two concise, lowercase, past-tense lines for the changeset body:

- Lead with user-visible fixes and features.
- Skip release commits, pure formatting, and routine dependency noise unless that is all the range contains.
- Mention package names only when they clarify ownership.
- Ask the user for help only if the history is genuinely ambiguous.

## 4. Create and consume the changeset

1. Create `.changeset/release-<timestamp>.md`.
2. Generate its YAML frontmatter from every package in the current `fixed[0]`, assigning the chosen bump level. Do not duplicate the package list in this skill.
3. Put the derived summary after the frontmatter.
4. Run `pnpm version-packages`.
5. Verify the changeset was consumed, every fixed package now has one identical version, and that version equals `EXPECTED_VERSION`. Record it as `NEXT_VERSION`; stop on any mismatch.

## 5. Format and commit the release

1. Run `pnpm lint`. It runs Biome with auto-fix. If it exposes unrelated failures or modifies unrelated files, stop and show them.
2. Inspect `git status`, the unstaged diff, and the staged diff.
3. Stage `.changeset/`, every fixed package's `package.json` and `CHANGELOG.md`, and only other files changed by this release operation. Never use `git add -A`.
4. Commit exactly `chore(release): <NEXT_VERSION>` without skipping hooks or signing.
5. Push the current branch normally.

## 6. Publication checkpoint

Show the user:

- `PREV_VERSION -> NEXT_VERSION`
- the release commit SHA
- the changeset summary
- the fixed package count and names
- the remaining visible or irreversible steps: npm publication and package tags, fast-forwarding `main`, the umbrella tag, and the GitHub release

Wait for explicit approval. Invoking this skill does not approve npm publication.

## 7. Publish packages and package tags

After approval, run:

```sh
./publish-packages.sh --yes
```

This script is the authoritative publisher for passkey-only npm 2FA. It builds, uses `pnpm pack` to rewrite `workspace:*`, rejects workspace leaks, publishes with npm, and creates and pushes each per-package tag. Do not replace it with `pnpm release:npm`, `changeset publish`, or `git push --tags`.

If publication fails partway, stop and surface the output. The script is intentionally idempotent; after the cause is fixed, rerun it to finish missing packages and tags.

## 8. Fast-forward main

1. Check out `main`.
2. Run `git merge --ff-only <ORIGINAL_BRANCH>`.
3. If fast-forwarding is impossible, stop and ask how to reconcile the branches. Never force or silently create a merge release commit.
4. Push `main` and return to `ORIGINAL_BRANCH`.
5. Verify the release commit is reachable from `main`.

## 9. Prepare the umbrella GitHub release

Use `v<NEXT_VERSION>` as the umbrella tag and the release commit as its anchor.

Check the resumable state before acting:

- If a local or remote umbrella tag exists, verify it points to the anchor. Stop on divergence.
- Run `gh release view v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev`. If it exists, show its URL and ask whether to leave it, edit its notes, or recreate it.

Build complete release notes from conversation context, commits and diffs since the prior package tag, the new changelog section, and the tone of the previous GitHub release. Use these sections in order and omit empty sections:

1. `## Highlights`
2. `## Bug Fixes`
3. `## Chores`
4. `## Migrations`
5. `## Breaking Changes`

For every note:

- Explain the user-visible change, why it matters, and any consumer action.
- Lead package-specific bullets with bold code package names; use **monorepo** for cross-cutting changes.
- Mark breaking behavior and migration steps explicitly.
- Exclude routine dependency and lockstep-version noise.

Always end with:

```text
All other `@byline/*` packages bumped to `<NEXT_VERSION>` in lockstep with no behavioural changes this cycle.
```

Show the complete notes, version, and anchor SHA. Wait for explicit approval before creating or editing any umbrella release artifact.

## 10. Create missing umbrella artifacts

After approval, perform only the missing idempotent steps:

```sh
git tag v<NEXT_VERSION> <anchor-sha>
git push origin v<NEXT_VERSION>
gh release create v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev --title "v<NEXT_VERSION>" --notes-file <notes-file>
```

If editing an existing release was approved, use `gh release edit` instead. Report the final GitHub release URL and final branch and worktree status.

Never amend release commits, force-push, move existing package tags, bypass hooks, or publish without the publication checkpoint.
