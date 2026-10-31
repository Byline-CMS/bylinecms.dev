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

## III Squashing the Drizzle migrations before a release

Each release ships one squashed Drizzle migration per adapter as the fresh-install baseline that `byline init` applies. Existing installations never run that baseline; they upgrade with the hand-written scripts in `packages/db-postgres/sql/` and `packages/db-mysql/sql/`. A human does the squash at release preparation, after every feature in the release has its hand-written upgrade script.

The squash replaces the migration chain with a single new `0000` migration whose journal timestamp is newer than anything a local database has applied. Drizzle decides what to apply by comparing that timestamp with the newest row in its ledger (`drizzle.__drizzle_migrations` on PostgreSQL, `__drizzle_migrations` on MySQL), so after a squash every local database that already ran the old chain would try to re-apply the whole baseline and fail with "already exists". Step 4 below re-keys those ledgers so the databases are recognised as up to date.

1. **Bring every local database up to date with the old chain** — `pnpm drizzle:migrate` for the development databases, and an integration run (or `pnpm db:init:test` / `pnpm db:init:test:mysql`) for the `*_test` databases. The squash is only safe to re-key onto a database that applied every migration being squashed.

2. **Squash.** In each adapter, delete `src/database/migrations/*.sql` and everything in `src/database/migrations/meta/`, then regenerate:

   ```sh
   pnpm --filter @byline/db-postgres drizzle:generate
   pnpm --filter @byline/db-mysql drizzle:generate
   ```

   Each adapter now has one `0000_<name>.sql`, its `meta/0000_snapshot.json`, and a one-entry `meta/_journal.json`.

3. **Check the squash changed nothing.** The new snapshot must describe exactly the schema the old chain produced. Compare it with the last pre-squash snapshot, ignoring the snapshot ids (run from the repository root; set `ADAPTER` and `LAST` to the adapter and the last pre-squash snapshot, e.g. `0001_snapshot.json`):

   ```sh
   ADAPTER=db-postgres LAST=0001_snapshot.json node -e '
     const fs = require("node:fs"), { execSync } = require("node:child_process")
     const dir = `packages/${process.env.ADAPTER}/src/database/migrations/meta`
     const strip = ({ id, prevId, ...rest }) => rest
     const before = strip(JSON.parse(execSync(`git show HEAD:${dir}/${process.env.LAST}`)))
     const after = strip(JSON.parse(fs.readFileSync(`${dir}/0000_snapshot.json`, "utf8")))
     console.log(JSON.stringify(before) === JSON.stringify(after) ? "schema identical" : "SCHEMA DIFFERS")'
   ```

   Stop if it reports a difference: the schema moved during the squash.

4. **Re-key each local database's ledger** with the helper. It reads each adapter's one-entry journal, computes the new key (the SHA-256 of the new `0000` file, plus the entry's `when`), and replaces the ledger rows with that single row in one transaction. It is a dry run unless you pass `--apply`:

   ```sh
   pnpm drizzle:rekey                      # development databases (.env), dry run
   pnpm drizzle:rekey -- --apply           # development databases, write
   pnpm drizzle:rekey:test -- --apply      # *_test databases (.env.test)
   ```

   Each adapter also has its own `pnpm --filter @byline/db-postgres drizzle:rekey` (and `@byline/db-mysql`). The helper only touches the Drizzle ledger — no schema, no data — and refuses to run when:

   - the database name does not end in `_dev` or `_test`;
   - the journal has more than one entry (nothing has been squashed);
   - the database has no ledger, or an empty one (a fresh database needs `drizzle:migrate` instead);
   - the ledger holds a row newer than the baseline (the database ran migrations generated after this squash).

   Running it again on a re-keyed database reports "already keyed" and changes nothing. It cannot check that the database applied every squashed migration — that is what step 1 guarantees.

   Never re-key a deployed database. Deployed installations upgrade through the `sql/` scripts and do not run Drizzle migrations at all. For a disposable `*_test` database, re-initialising it (`pnpm db:init:test`, `pnpm db:init:test:mysql`) is an equally good alternative.

   If you need to do it by hand, the helper's equivalent is:

   ```sql
   -- PostgreSQL
   BEGIN;
   DELETE FROM drizzle.__drizzle_migrations;
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256 of 0000_*.sql>', <journal when>);
   COMMIT;

   -- MySQL (in the target database)
   START TRANSACTION;
   DELETE FROM __drizzle_migrations;
   INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('<sha256 of 0000_*.sql>', <journal when>);
   COMMIT;
   ```

5. **Verify.** `pnpm drizzle:migrate` must report success without applying anything, and each ledger must hold exactly one row whose hash matches the new file:

   ```sql
   SELECT count(*), max(hash) FROM drizzle.__drizzle_migrations;   -- PostgreSQL
   SELECT count(*), max(hash) FROM __drizzle_migrations;            -- MySQL
   ```

   A focused integration run (for example `pnpm --filter @byline/db-postgres test:integration`) confirms the test runner's startup migration is also a no-op.

6. **Sync the CLI baselines** so `byline init` installs the new schema, then check them:

   ```sh
   pnpm --filter @byline/cli sync:baselines
   pnpm --filter @byline/cli check:templates
   pnpm --filter @byline/cli check:artifact
   ```

7. **Commit** the squash and the synced baselines (for example `chore(db): squashed drizzle migrations` and `chore(cli): synced squashed database baselines`), with `git commit -s`.
