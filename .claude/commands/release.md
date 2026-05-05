---
name: release
description: Create the umbrella GitHub release for the current lockstep version. Run after `pnpm release:npm` and `git push --tags`.
allowed-tools: Bash, Read, Write
argument-hint: [optional version override, e.g. v1.2.1]
---

Create the umbrella GitHub release for the current lockstep `@byline/*` version.

Context: this monorepo locks all `@byline/*` packages to a single version. `pnpm release:npm` publishes to npm and emits per-package git tags (`@byline/core@1.2.1`, `@byline/host-tanstack-start@1.2.1`, etc.). This command creates the **umbrella** `v<version>` tag + a single GitHub release that summarises the cycle. Per-package tags are not used as release anchors — they're npm bookkeeping only.

## Preconditions

Before doing anything, verify:

1. **`gh` is installed and authenticated** — `gh auth status` should show a logged-in account with `repo` scope. If not, stop and tell the user to install / log in.
2. **Working tree is clean** — `git status --porcelain` should be empty. If not, stop and ask whether to proceed.
3. **Per-package tags exist locally and on origin.** Read the version from `packages/core/package.json`. Then check that `@byline/core@<version>` exists locally (`git tag --list "@byline/core@<version>"`) and on origin (`git ls-remote --tags origin "@byline/core@<version>"`). If either is missing, stop and tell the user to run `pnpm release:npm` followed by `git push --tags` first — the umbrella release should never run ahead of the npm publishes.

## Steps

1. **Resolve the version.** If `$ARGUMENTS` is non-empty, treat it as a version override (strip a leading `v` if present). Otherwise read `packages/core/package.json`'s `version` field. The umbrella tag will be `v<version>`.

2. **Find the anchor commit.** Run `git rev-list -n 1 "@byline/core@<version>"`. That commit is where `pnpm version-packages` ran — the umbrella tag must point at the same commit so the release diff matches the npm publishes.

3. **Detect prior state (idempotency).**
   - Local umbrella tag exists? `git tag --list v<version>`. If yes, verify it points at the same anchor commit (`git rev-list -n 1 v<version>`); if it diverges, stop and ask the user how to handle it. If it matches, skip the local-tag step.
   - Remote umbrella tag exists? `git ls-remote --tags origin v<version>`. If yes, skip the push step.
   - Existing GitHub release? `gh release view v<version> --repo Byline-CMS/bylinecms.dev` (capture exit code, don't fail). If a release already exists, show its URL and ask the user whether to (a) leave it alone, (b) edit its notes, or (c) delete + recreate. Don't proceed silently.

4. **Synthesize release notes.** Compose a short summary (3–6 bullets, one per affected package) describing what shipped in this version. Match the shape of v1.2.1's release:
   - Lead each bullet with the package name in backticks: `` `@byline/host-tanstack-start` ``.
   - Mark breaking changes inline with **breaking**: in bold.
   - Focus on user-visible behaviour and migration impact, not implementation detail.
   - Skip "patch dependencies updated" noise — those are auto-generated CHANGELOG entries, not release-note prose.

   **Source priority for the prose:**
   1. The current conversation's context — if you've been doing the work in this session, you already have the best summary.
   2. The most recent changeset summary — git log around the anchor commit usually has it as a `chore: changeset` commit.
   3. The top section of `packages/core/CHANGELOG.md` — strip the `### Patch Changes` / `### Minor Changes` headers and the trailing `Updated dependencies` block; keep the human prose.

   If you can't construct a confident summary, stop and ask the user for a paragraph rather than guessing.

5. **Confirm before any visible action.** Show the user:
   - The version (`v<version>`)
   - The anchor commit SHA (short form)
   - The full proposed release notes
   - A list of the steps about to run (create local tag / push tag / create release — only the ones not already done)

   Wait for explicit approval. The user typing the command isn't sufficient — show them the body first.

6. **Execute.** Write the notes to `/tmp/release-notes-v<version>.md`. Then in order, only running the steps actually needed:
   - `git tag v<version> <anchor-sha>`
   - `git push origin v<version>`
   - `gh release create v<version> --repo Byline-CMS/bylinecms.dev --title "v<version>" --notes-file /tmp/release-notes-v<version>.md`

7. **Report.** Print the release URL returned by `gh release create` (or by `gh release view` if it already existed and the user chose to leave it).

## Failure modes to handle gracefully

- `gh release create` fails because the repo's default release branch protection forbids it → surface the error verbatim and stop.
- Anchor commit is not on `main` → warn the user. The release should usually anchor to `main`; ask if they really want a release pointing at a feature branch.
- The user passes a version override that doesn't match any per-package tag → stop and ask if they intend to release a version that hasn't been published yet.

## What this command does NOT do

- It does NOT publish to npm. That's `pnpm release:npm`.
- It does NOT push commits — only the umbrella tag. Run `git push` separately if needed (the precondition check assumes you've already pushed `main`).
- It does NOT edit per-package tags. They are immutable npm-bookkeeping artefacts.
- It does NOT create draft releases by default. If the user wants a draft, they say so when confirming.
