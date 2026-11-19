# Package Changset and Release Instructions

## I: Auto flow with GitHub action:

NOTE: This flow will use a GitHub action (if present) to version packages based on a pending changeset in the .changeset directory, and then create a PR to be merged after manual review. Once the PR has been accepted, the action will then publish the package to NPM.

1. `pnpm changeset`

Choose packages to version with major, minor or patch releases.
Write a summary for the change set.

2. Git commit the change set to main and push.

3. The github action will create a pull request for the changeset

4. Manually review and accept the PR - the github action will then publish to npm.

NOTE: the auto-flow GitHub action will also create a Releases entry in the repo as well as attach zipped binaries.

IMPORTANT: It's important that everyone then git fetches, git pulls the latest from the main branch of the repo, and merges / rebases their local branches to bring them up to date with the release.

## II Manual flow:

NOTE: You'll need to log in to NPM on the command line before starting: `npm login`

1. `pnpm changeset`

Choose packages to version with major, minor or patch releases.
Write a summary for the change set.

2. `pnpm version-packages`

This will call changeset version, updating all package.json versions and updating release notes. It will also clear / remove the pending changeset from the .changeset directory.

3. Commit + push the version bump as `chore(release): X.Y.Z`, then run `./publish-packages.sh`.

This replaces `pnpm release:npm` / `changeset publish`, which **cannot publish under passkey-only 2FA** — pnpm's OTP pre-check accepts only a typed numeric code and dead-ends at `ERR_PNPM_OTP_NON_INTERACTIVE`. The script builds all packages, then for each package in the `fixed` group it `pnpm pack`s (rewriting `workspace:*` deps into real versions), `npm publish`es the tarball (plain npm honours the `~/.npmrc` bypass token silently), and creates + pushes per-package git tags. It is idempotent — already-published packages and existing tags are skipped — so a partial failure is safe to re-run. Use `./publish-packages.sh --dry-run` to pack + verify without publishing.

NOTE: The manual flow will not create a Releases entry in the repo (and therefore not create any attached zip binaries). Create the umbrella GitHub release separately — or use the `/release` command, which orchestrates this whole sequence (changeset → version-packages → release commit → `./publish-packages.sh` → main sync → umbrella release).

## III Verify core storage migration assets

Each SQL adapter ships its own frozen baseline and numbered suffix. PostgreSQL starts at 0015 and MySQL at 0010. Preserve all released runner SQL, manifests and legacy scripts byte for byte. Drizzle generation under `src/database/migrations/` supplies development diffs when authoring a new numbered step.

1. Compare fresh installation and native-upgraded catalogs against the intended schema and rehearse recovery on isolated databases. For MySQL interrupt the physical session at each newly introduced durable DDL prefix and verify supervised recovery.
2. Run `pnpm --filter @byline/cli check:templates` and `pnpm --filter @byline/cli check:artifact` after building both adapters and the CLI. The packed CLI must resolve both exact adapter versions and validate their raw SQL before host dependencies are present.
3. Run `node scripts/check-native-sql-history.mjs --base <previous-release-tag>`. Apply a new suffix through the adapter. Never re-key the host or core journals.
4. Before classifying a step online, run the matching `check:postgres-compatibility` or `check:mysql-compatibility` script in `@byline/cli` against each admitted prior package release. For MySQL, record each verified server patch, exercise every durable prefix and retain the worker, reader, writer, statement and lock-budget results. MySQL needs a second session on the same direct server to cancel an over-budget statement.
