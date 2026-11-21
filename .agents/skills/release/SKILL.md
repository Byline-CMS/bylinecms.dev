---
name: release
description: Orchestrate the guarded, resumable lockstep release of the Byline monorepo's @byline/* packages, from changeset and version commit through npm publication, branch synchronization, tags, and the umbrella GitHub release. Use only when the user explicitly invokes $release, optionally with patch, minor, or major and --skip-ci.
---

# Release Byline

Drive a complete lockstep release for the package names in `.changeset/config.json` `fixed[0]`. Treat any accompanying `patch`, `minor`, or `major` as the requested bump. Never hard-code the package count or list.

`--skip-ci` may accompany the bump level, in either order. By default, publication waits until CI has passed on the exact commit `./publish-packages.sh` will tag. With `--skip-ci`, publication does not wait; CI keeps running and the release notes record the bypass with a link to the run. The flag skips the wait, never a known failure: a run that has already failed blocks both modes.

The workflow is resumable, but npm publication is irreversible. Require explicit approval immediately before running `./publish-packages.sh --yes`, and require a second approval after showing the complete umbrella GitHub release notes.

## 1. Preflight

Before changing files or remotes:

1. Run `gh auth status` and `npm whoami`; stop if GitHub or npm authentication is unavailable.
2. Require an empty `git status --porcelain`. Do not sweep unrelated work into a release.
3. Record the current branch as `ORIGINAL_BRANCH`. Releases normally land on `develop`; if currently on `main` or a feature branch, ask before continuing.
4. Run `git fetch origin`. Verify local and remote `develop` and `main` exist, then use `git rev-list --left-right --count <branch>...origin/<branch>` to require `0 0` for both. Stop on divergence.
5. Check for a prepared release (see [Resuming a prepared release](#resuming-a-prepared-release)); otherwise read `PREV_VERSION` from `packages/core/package.json`.
6. Read the exact fixed package names from `.changeset/config.json`, map each to its `packages/*/package.json`, and verify every current version equals `PREV_VERSION`.
7. Verify `@byline/core@<PREV_VERSION>` resolves and use it as the release-range anchor.

### Resuming a prepared release

Before reading `PREV_VERSION`, read the current version `V`. If the umbrella tag `v<V>` exists neither locally nor on origin, and a commit whose subject is exactly `chore(release): <V>` is reachable from `HEAD`, an earlier run prepared `V` without finishing it, usually because the CI gate stopped it. Resume instead of starting a new release:

1. Set `NEXT_VERSION=<V>` and `RELEASE_COMMIT` to that commit's full SHA. Read `PREV_VERSION` from `git show <RELEASE_COMMIT>^:packages/core/package.json`.
2. Show `PREV_VERSION -> NEXT_VERSION`, `RELEASE_COMMIT`, `HEAD`, and `git log --oneline <RELEASE_COMMIT>..HEAD`, and ask the user to confirm resuming. Create no changeset or release commit.
3. If `HEAD` is not `RELEASE_COMMIT`, verify no fixed package's version differs from `NEXT_VERSION`, re-run the database schema gates with `--base "v${PREV_VERSION}"`, and push the branch if it is ahead of origin.
4. If any per-package tag `<name>@<NEXT_VERSION>` points at a commit other than `HEAD`, stop and ask how to reconcile.
5. Continue at the CI gate. If an earlier attempt already published some packages, `./publish-packages.sh` skips them and finishes the rest and the tags. The CI line in the release notes reflects the gate decision made in this session.

### Database schema gates

Before choosing or consuming the release changeset, run this sequence from the
repository root:

```sh
pnpm check:native-sql-history -- --base "v${PREV_VERSION}"
pnpm build:packages
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/cli check:artifact
pnpm --filter @byline/cli check:storage-release
```

These are the core storage gates from
[Release instructions §III](../../../RELEASE-INSTRUCTIONS.md#iii-verify-core-storage-migration-assets).
Each SQL adapter ships its own frozen baseline and numbered steps under
`packages/db-*/migrations/`; there is no CLI baseline to squash or synchronise.
The history guard requires every released numbered SQL file under
`packages/db-*/sql/` and `packages/*/migrations/`, and every core manifest, to
remain present and byte-identical. The template and artifact checks confirm the
packed CLI resolves both exact adapter versions and validates their raw SQL.
`check:storage-release` packs the Byline dependency graph into a clean consumer
and exercises setup, adoption, startup and release jobs; it needs
`BYLINE_CLI_POSTGRES_ADMIN_URL` and `BYLINE_CLI_MYSQL_ADMIN_URL` pointing at
loopback test servers (set in `packages/cli/.env.test`).

If the release adds a new numbered core step, also complete the remaining §III
items — catalog and recovery rehearsal, and the `check:postgres-compatibility` /
`check:mysql-compatibility` evidence before classifying any step online. Stop
before versioning, build, pack, or publication if any command fails.

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

## 5b. CI gate

Capture the full anchor SHA once: `RELEASE_ANCHOR="$(git rev-parse HEAD)"`. Use this value for the CI lookup, the publication checkpoint, the pre-publish check, and the umbrella tag; never re-read `HEAD` in its place. Normally it is the release commit. After a fix-forward it is the newest fix commit above the release commit. Confirm it is on origin, pushing first if not.

Find or start the run:

- On `develop`, the push started a run. `.github/workflows/ci.yml` gives a pushed `chore(release):` commit its own concurrency group keyed by SHA, so neither the parent commit's run nor a later `develop` push can cancel it.
- On any other branch, pushes start no run and a pull request run tests a merge commit. Dispatch one immediately with `gh workflow run ci.yml --repo Byline-CMS/bylinecms.dev --ref <branch>` and accept only a `workflow_dispatch` run. If GitHub rejects the dispatch, stop in both modes and suggest releasing from `develop`.

```sh
gh run list --repo Byline-CMS/bylinecms.dev --workflow ci.yml --commit "$RELEASE_ANCHOR" \
  --json databaseId,status,conclusion,event,headSha,url --limit 5
```

Use the newest run whose `headSha` equals `RELEASE_ANCHOR`, retrying for up to about two minutes while GitHub registers it. Record `CI_RUN_ID` and `CI_RUN_URL`. If no run appears, stop in both modes: a missing run is never a pass, and `--skip-ci` needs a run to link.

Evaluate the run and its jobs with `gh run view "$CI_RUN_ID" --repo Byline-CMS/bylinecms.dev --json status,conclusion,headSha,jobs`. A fast job can fail while the integration suite keeps the run `in_progress`. The run has a **known failure** if its `conclusion` is anything other than empty or `success`, or if any job concluded `failure`, `cancelled`, `timed_out` or `action_required`.

- **Known failure:** stop in both modes. Show the failed jobs (`gh run view <id> --repo Byline-CMS/bylinecms.dev --log-failed`, truncated) and offer `gh run rerun <id> --repo Byline-CMS/bylinecms.dev --failed` for a suspected flake. For a real defect, land the fix above the release commit and push. Either way, invoking the release again resumes the prepared version here. Never reset or force-push the shared branch.
- **Completed with `success`:** continue with `CI_STATUS=passed`, in either mode.
- **Queued or in progress with no failed job, default mode:** wait without busy-polling (for example `gh run watch "$CI_RUN_ID" --repo Byline-CMS/bylinecms.dev --exit-status` in the background; a full run takes roughly 15–40 minutes), then evaluate again.
- **Queued or in progress with no failed job, `--skip-ci`:** continue immediately with `CI_STATUS=bypassed`.

## 6. Publication checkpoint

Show the user:

- `PREV_VERSION -> NEXT_VERSION`
- `RELEASE_ANCHOR` (full SHA), and whether it is the release commit or a fix-forward commit
- CI: `passed — <CI_RUN_URL>`, or `in progress, bypassed with --skip-ci — <CI_RUN_URL>` with a reminder that its outcome will not stop this publication
- the changeset summary
- the fixed package count and names
- the remaining visible or irreversible steps: npm publication and package tags, fast-forwarding `main`, the umbrella tag, and the GitHub release

Wait for explicit approval. Invoking this skill does not approve npm publication.

## 7. Publish packages and package tags

Immediately after approval, re-check that `git rev-parse HEAD` equals `RELEASE_ANCHOR` and `git status --porcelain` is empty, then re-evaluate `CI_RUN_ID` as in the CI gate. A moved checkout, a dirty tree, or a known failure that appeared during the approval prompt stops publication in both modes. Then run:

```sh
./publish-packages.sh --yes
```

The script tags `HEAD`, which the re-check above just confirmed is `RELEASE_ANCHOR`.

This script is the authoritative publisher for passkey-only npm 2FA. It builds, uses `pnpm pack` to rewrite `workspace:*`, rejects workspace leaks, publishes with npm, and creates and pushes each per-package tag. Do not replace it with `pnpm release:npm`, `changeset publish`, or `git push --tags`.

If publication fails partway, stop and surface the output. The script is intentionally idempotent; after the cause is fixed, rerun it to finish missing packages and tags.

## 8. Fast-forward main

1. Check out `main`.
2. Run `git merge --ff-only <ORIGINAL_BRANCH>`.
3. If fast-forwarding is impossible, stop and ask how to reconcile the branches. Never force or silently create a merge release commit.
4. Push `main` and return to `ORIGINAL_BRANCH`.
5. Verify the release commit is reachable from `main`.

## 9. Prepare the umbrella GitHub release

Use `v<NEXT_VERSION>` as the umbrella tag and `RELEASE_ANCHOR` as its anchor. Confirm `git rev-list -n 1 "@byline/core@<NEXT_VERSION>"` equals it (in a new session, recover the anchor from that tag); stop if it does not.

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

Immediately before the closing line, add one CI line: `CI: passed before publication — <CI_RUN_URL>`, or with `--skip-ci` and an unfinished run, `CI: published without waiting for CI (--skip-ci) — <CI_RUN_URL>`. The run page shows the eventual result, so the notes are never edited afterwards.

Always end with:

```text
All other `@byline/*` packages bumped to `<NEXT_VERSION>` in lockstep with no behavioural changes this cycle.
```

Show the complete notes, version, and anchor SHA. Wait for explicit approval before creating or editing any umbrella release artifact.

## 10. Create missing umbrella artifacts

After approval, perform only the missing idempotent steps:

```sh
git tag v<NEXT_VERSION> <RELEASE_ANCHOR>
git push origin v<NEXT_VERSION>
gh release create v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev --title "v<NEXT_VERSION>" --notes-file <notes-file>
```

If editing an existing release was approved, use `gh release edit` instead. Report the final GitHub release URL and final branch and worktree status. With `--skip-ci`, also report `CI_RUN_URL` and the run's current state; a failure after publication is fixed in a follow-up patch release, never by unpublishing.

Never amend release commits, force-push, move existing package tags, bypass hooks, publish over a failed CI run, or publish without the publication checkpoint.
