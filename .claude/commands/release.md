---
name: release
description: Full lockstep release for @byline/* — changeset → version-packages → lint → release commit → npm publish → push tags → sync develop/main → umbrella GitHub release.
allowed-tools: AskUserQuestion, Bash, Read, Write
argument-hint: [optional bump level: patch|minor|major]
---

Drive the full release loop for the `@byline/*` lockstep set, end to end. The publishable packages listed under `fixed` in `.changeset/config.json` (currently 15) always move together to the same version. Always read the set from that file — it has grown before.

## What this command does

1. Asks the user for the bump level (patch / minor / major).
2. Derives a one- or two-line changeset summary from the commits since the previous release and writes a changeset file naming every package in the fixed group at the chosen bump level.
3. Runs `pnpm version-packages` and verifies every `@byline/*` package landed on the same new version and that the version delta matches the requested bump level.
4. Runs `pnpm lint` to auto-fix any formatting churn on the bumped CHANGELOGs / package.json files.
5. Stages the bump + lint output and creates a single `chore(release): X.Y.Z` commit on the current branch (usually `develop`).
6. Pushes that branch.
7. Runs `./publish-packages.sh` — builds, packs (rewriting `workspace:*` deps), `npm publish`es each package, and creates + pushes per-package tags. Replaces `changeset publish` / `pnpm release:npm`, which dead-ends under passkey-only 2FA.
8. Fast-forwards `main` to the release commit and pushes it, bringing `develop` and `main` back into sync.
9. Creates the umbrella `v<version>` tag and a single GitHub release that summarises the cycle (the prior behaviour of this command, preserved).

The command is idempotent at every step — re-running after a partial failure should detect what's already done and skip it.

## Preconditions

Before any visible action, verify all of these. If any fails, stop and explain what the user needs to do:

1. **`gh` is installed and authenticated** — `gh auth status` shows a logged-in account with `repo` scope.
2. **Working tree is clean** — `git status --porcelain` is empty. (Otherwise the release commit would sweep up unrelated work.)
3. **Both `develop` and `main` exist locally and on origin**, and both are up to date with their tracking branches (`git fetch origin && git rev-list --left-right --count <branch>...origin/<branch>` shows `0 0`).
4. **You are on a branch where the release should land** — normally `develop`. If on `main` or a feature branch, confirm with the user before proceeding.
5. **Read the *current* version** from `packages/core/package.json` and stash it as `PREV_VERSION`. This is the "before" anchor for the bump-level check.

## Step 1 — Choose bump level

If `$ARGUMENTS` is one of `patch` / `minor` / `major`, use that. Otherwise ask via `AskUserQuestion`:

- Question: `"Release bump level for v<PREV_VERSION> → next?"`
- Header: `"Bump level"`
- Options (in this order): **Patch (Recommended)** (bug fixes, internal chores), **Minor** (backward-compatible features / migrations), **Major** (breaking changes).

## Step 2 — Derive the changeset summary from commits

Do **not** ask the user for a summary. Build a short one (one or two lines, never a paragraph) from the commits between the previous release and `HEAD`:

```sh
git log --oneline "@byline/core@<PREV_VERSION>..HEAD"
```

Rules for synthesising the line(s):

- Lead with the most user-visible change in the range. Bug fixes and features beat chores; chores beat dependency bumps.
- Mention package scope in bold backticks when it disambiguates (e.g. **`@byline/db-postgres`**, **`@byline/richtext-lexical`**) — otherwise keep it general.
- Past tense, lowercase, no trailing period. Style should read like a one-line changelog entry, e.g. *"fixed relation/file removal save crash and richtext caret-jump regression"*.
- Skip release commits (`chore(release): …`), pure lint/format commits, and dep bumps unless that's literally all there is in the range.
- Hard cap: two lines. If you can't compress the range into two lines, pick the two highest-impact items and drop the rest — the longer prose belongs in the umbrella GitHub release notes in Step 11, not in the per-package CHANGELOGs.

This text goes verbatim into the changeset markdown body, where `pnpm version-packages` fans it out into every `@byline/*` CHANGELOG.

## Step 3 — Write the changeset file

Pick a slug — `release-<timestamp>` is fine (e.g. `release-2026-05-22-1545`). Write `.changeset/<slug>.md` with frontmatter listing every package in the fixed group, all at the chosen bump level, followed by the summary derived in Step 2:

The list below is a snapshot for shape only — generate the real one from
`fixed[0]`, never by copying this:

```markdown
---
"@byline/admin": <level>
"@byline/ai": <level>
"@byline/auth": <level>
"@byline/cli": <level>
"@byline/client": <level>
"@byline/core": <level>
"@byline/db-postgres": <level>
"@byline/generated-types": <level>
"@byline/host-tanstack-start": <level>
"@byline/i18n": <level>
"@byline/richtext-lexical": <level>
"@byline/search-postgres": <level>
"@byline/storage-local": <level>
"@byline/storage-s3": <level>
"@byline/ui": <level>
---

<user-supplied summary>
```

The package list must match `fixed[0]` in `.changeset/config.json` — re-read it rather than hard-coding, so it stays in sync if the set changes.

## Step 4 — Run version-packages

`pnpm version-packages` (non-interactive — it consumes the changeset file). After it completes:

- Read every `@byline/*` `packages/*/package.json` `version` field. Confirm they are all identical. If not, **stop** and show the divergence — something is wrong with the `fixed` group.
- Compute the expected next version from `PREV_VERSION` and the chosen bump level (e.g. `2.3.0` + patch = `2.3.1`, + minor = `2.4.0`, + major = `3.0.0`). Confirm the new version matches. If not, stop and show the actual vs expected.
- Record this as `NEXT_VERSION`.

## Step 5 — Lint

`pnpm lint` (the root script runs Biome with auto-fix). If it fails on unrelated issues, stop and surface the output. If only the CHANGELOG / package.json files got reformatted, continue.

## Step 6 — Release commit

Stage the bump artefacts explicitly — do **not** use `git add -A`:

- `git add .changeset/` (the consumed changeset file is removed; the config stays — both diffs land here)
- `git add packages/*/package.json packages/*/CHANGELOG.md`
- If lint touched anything else (e.g. webapp / docs), include only the files actually modified by the bump or by lint in this turn.

Commit with the literal message `chore(release): <NEXT_VERSION>` (match the format of past release commits — e.g. `chore(release): 2.3.0`). Then `git push` on the current branch.

## Step 7 — Confirm before publishing

Stop here and show the user:

- `PREV_VERSION → NEXT_VERSION`
- The anchor commit SHA (short form, just-pushed `HEAD`)
- The changeset summary line(s) you derived in Step 2
- The list of remaining steps: `./publish-packages.sh` (publish + push per-package tags) → fast-forward `main` and push → create umbrella tag + GitHub release.

Wait for explicit approval. `./publish-packages.sh` actually publishes to the public npm registry and is not trivially reversible — the user must confirm.

## Step 8 — Publish to npm (+ push per-package tags)

`./publish-packages.sh --yes` — Step 7 already captured explicit approval, so `--yes` skips the script's own (otherwise redundant) confirmation prompt.

This replaces `changeset publish` / `pnpm release:npm`, which **cannot publish under passkey-only 2FA** — pnpm's OTP pre-check accepts only a typed numeric code and dead-ends at `ERR_PNPM_OTP_NON_INTERACTIVE`. The script:

- Builds all `packages/*` via turbo.
- For each package in `.changeset/config.json` `fixed[0]`: `pnpm pack` (which rewrites `workspace:*` into real versions), guards against a `workspace:` leak in the tarball, then `npm publish <tarball> --access public` (plain npm honours the `~/.npmrc` bypass token silently).
- Creates per-package git tags at the release commit (`@byline/core@<NEXT_VERSION>`, etc.) **and pushes them** — so the old "push tags" step is already done.

It is **idempotent**: packages already live at `NEXT_VERSION` are skipped and existing tags are left alone, so re-running after a partial failure just finishes the set. Run `./publish-packages.sh --dry-run` first if you want to pack + verify without publishing.

If publish fails partway, surface the script's output verbatim and stop. Re-running the script is the intended recovery path (it skips what's already done) — but only after the user diagnoses why it failed.

## Step 9 — Push tags

Already handled by `./publish-packages.sh` in Step 8 — it pushes each per-package tag as it goes. Nothing to do here unless the script reported a tag-push failure, in which case `git push origin <tag> …` the ones it names.

## Step 10 — Sync `main`

Bring `main` up to the release commit so the two branches don't drift:

- `git checkout main`
- `git merge --ff-only develop` (or whichever branch the release landed on — use the branch you were on at the start). If fast-forward isn't possible because `main` has commits `develop` doesn't, **stop** and ask the user how to reconcile.
- `git push origin main`
- `git checkout <original-branch>` to return to where you started.

## Step 11 — Umbrella GitHub release

This is the original `/release` behaviour, run with `NEXT_VERSION`:

1. **Find the anchor commit.** `git rev-list -n 1 "@byline/core@<NEXT_VERSION>"`. The umbrella tag points here.
2. **Detect prior state (idempotency).**
   - Local umbrella tag `v<NEXT_VERSION>` exists? Verify it points at the anchor commit; if it diverges, stop and ask. If it matches, skip the create step.
   - Remote umbrella tag exists? Skip the push step.
   - Existing GitHub release? `gh release view v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev` (capture exit code). If a release already exists, show its URL and ask whether to (a) leave it, (b) edit notes, or (c) delete + recreate.
3. **Synthesize release notes.** Group changes into these sections, in this order. Omit any section that has no entries — never include an empty heading.

   ```markdown
   ## Highlights

   New features, enhancements, and any other non-breaking, non-migrating changes likely to be of user interest. Lead each bullet with the affected package(s) in bold backticks: **`@byline/host-tanstack-start`**.

   ## Bug Fixes

   Direct bug fixes — regressions, packaging fixes, runtime corrections. Same bullet shape as Highlights.

   ## Chores

   Internal-tooling and dev-experience changes that don't alter consumer behaviour but are worth recording in the cycle (e.g. wiring a bundle analyzer, updating the CLI dep manifest). Brief — usually one line per item.

   ## Migrations

   Non-breaking changes that nonetheless require the user to migrate existing data, run a script, or update configuration to take advantage of (or stay compatible with) the new behaviour. State the migration step explicitly.

   ## Breaking Changes

   Anything that requires the user to change code, config, or dependencies *before* the release will run. State both the breaking change and the required user action. Mark inline mentions elsewhere with **breaking**: in bold.
   ```

   Within each section:
   - Lead each bullet with the package name(s) in bold backticks: **`@byline/core`**, **`@byline/host-tanstack-start`**. Use **monorepo** (no backticks) for cross-cutting items that aren't owned by a single package.
   - Each bullet should be a substantive paragraph, not a commit subject. Explain *what* changed in user-visible terms, *why* it matters (the constraint or bug it addresses), and any *consumer-side effect* (migration step, bundle impact, new install footprint, behavioural change). Past tense.
   - Focus on user-visible behaviour and migration impact, not implementation detail. But name specific symbols (component names, hook names, env vars, route paths) when the user would search for them.
   - Skip "patch dependencies updated" noise — those are auto-generated CHANGELOG entries, not release-note prose.

   **Always** end the notes with this exact closing line, outside any section, even if all sections were populated:

   ```
   All other `@byline/*` packages bumped to `<NEXT_VERSION>` in lockstep with no behavioural changes this cycle.
   ```

   This is the standing convention for lockstep releases (see v2.3.0, v2.2.10, etc.) — it signals to consumers that any package they pin from the set has the same baseline as the rest, regardless of whether that specific package shows up in the sections above.

   **Source priority for the prose:**
   1. The conversation context for this release cycle — usually the strongest source if the work happened in-session.
   2. `git log --oneline "@byline/core@<PREV_VERSION>..HEAD"` plus per-commit diffs (`git show <sha>`) for anything that's not obvious from the subject line.
   3. The top section of `packages/core/CHANGELOG.md` (the Step 2 line) — expand it with package context, not replace it.

   The umbrella release notes can and should be longer than the changeset summary — full sections, multiple bullets per section, with the depth of prose seen in recent releases (open `gh release view v<PREV_VERSION> --repo Byline-CMS/bylinecms.dev` and match the tone). The Step 2 line is the headline; this is the cycle write-up.

   If you can't construct a confident summary, stop and ask the user for a paragraph rather than guessing.

4. **Confirm before any visible action.** Show the version, anchor SHA, full proposed release notes, and the list of steps about to run. Wait for explicit approval.

5. **Execute.** Write the notes to `/tmp/release-notes-v<NEXT_VERSION>.md`. Then, only running the steps actually needed:
   - `git tag v<NEXT_VERSION> <anchor-sha>`
   - `git push origin v<NEXT_VERSION>`
   - `gh release create v<NEXT_VERSION> --repo Byline-CMS/bylinecms.dev --title "v<NEXT_VERSION>" --notes-file /tmp/release-notes-v<NEXT_VERSION>.md`

6. **Report.** Print the release URL returned by `gh release create` (or by `gh release view` if it already existed and the user chose to leave it).

## Failure modes to handle gracefully

- `pnpm version-packages` produces no version change → no pending changesets were found; the changeset file likely wasn't written correctly. Surface and stop.
- Lockstep mismatch after `version-packages` → one or more packages didn't bump. Likely a `fixed` config drift. Show the divergence; stop.
- `./publish-packages.sh` fails partway → some packages published, some didn't. Surface the script output verbatim and stop, then let the user diagnose. Because the script is idempotent (skips already-published packages and existing tags), re-running it is the intended recovery once the cause is fixed.
- `git merge --ff-only develop` on `main` fails → `main` has diverged. Stop and ask the user how to reconcile (they may want a regular merge, a rebase of develop, or to manually align).
- `gh release create` fails because of branch protection → surface the error verbatim and stop.
- Anchor commit is not on `main` after the sync step → warn loudly. The release should anchor to a commit reachable from `main`.

## What this command does NOT do

- It does NOT do the publish itself — `./publish-packages.sh` does the actual npm publish and per-package tag creation/push; this orchestrator only invokes it (with `--yes`, after the Step 7 approval).
- It does NOT create draft GitHub releases by default. If the user wants a draft, they say so at the Step 11 confirmation.
- It does NOT edit per-package tags. They are immutable npm-bookkeeping artefacts.
- It does NOT skip hooks (`--no-verify`) or signing on the release commit.
