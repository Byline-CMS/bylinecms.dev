# CLI MySQL GA and migration-baseline policy — implementation plan

**Status:** Draft, revised after repository review

**Date:** 2026-07-27

**Primary outcome:** `byline init` and `byline setup` support PostgreSQL and MySQL without treating a squashed Drizzle baseline as an upgrade stream.

## Goal

Ship the remaining CLI work required for MySQL general availability while making the database-initialization policy explicit and mechanically safe:

- the user chooses PostgreSQL or MySQL in the CLI, or supplies the choice non-interactively;
- the chosen dialect drives provisioning, environment variables, dependencies, scaffold templates, search-provider wiring, and the bundled baseline;
- each CLI release carries exactly one squashed Drizzle baseline per dialect for a fresh database;
- a baseline is never applied to an occupied database, including under `--force`;
- an existing installation is upgraded with immutable, numbered native SQL from the source repository at the target release tag;
- the selected database adapter is pinned exactly to the CLI release that carries its baseline;
- search migrations remain owned and executed by the selected search package.

Completing this plan satisfies the remaining CLI criterion in issue #58. Benchmarking, MariaDB support, Docker-based provisioning, and a general-purpose migration runner are not MySQL GA gates.

## Acceptance criteria

1. `byline init --database postgres` preserves the current PostgreSQL installation outcome.
2. `byline init --database mysql` installs the MySQL database and search packages, writes the MySQL connection key, scaffolds a MySQL server config, provisions MySQL 8.0.14+, and applies the MySQL baseline to a fresh database.
3. Interactive `init` and `setup` prompt for a database when no persisted or command-line selection exists.
4. A persisted dialect is sticky. The CLI refuses to reinterpret an existing installation as another dialect.
5. PostgreSQL and MySQL baselines are byte-identical to their adapter source migrations, contain one SQL file and one matching journal entry, and contain no Drizzle snapshots.
6. On a reused non-empty database, the CLI exits before altering a role/user, installing an extension, granting privileges, or running Drizzle.
7. `--force` never weakens the non-empty-database guard. `--reset --i-mean-it` remains the explicit destructive path.
8. A selected `@byline/db-*` dependency must resolve to the exact CLI version. A pre-existing caret range is not accepted as equivalent.
9. The unselected database and search packages are not installed. Existing user-declared packages are preserved rather than removed.
10. Example scaffolds wire the search provider matching the selected database. Minimal scaffolds install neither search package.
11. PostgreSQL-only maintenance scripts are not copied into a MySQL scaffold.
12. One fresh-install and one occupied-database refusal smoke run per dialect execute in the existing database CI job; no new database matrix or repeated non-UTC CLI run is added.
13. Published CLI tarballs contain both baseline directories and all four required files.
14. Documentation describes MySQL as generally available after the implementation lands and accurately distinguishes fresh installation, reset, and upgrade workflows.

## Durable policy

### Two migration streams

| Stream | Owner | Consumer | Purpose |
|---|---|---|---|
| Squashed Drizzle baseline | `packages/db-{postgres,mysql}/src/database/migrations` | `@byline/cli` | Create the current schema from scratch |
| Native SQL upgrades | `packages/db-{postgres,mysql}/sql` | Operator/deployment process | Advance an existing installation |
| Search migrations | `@byline/search-{postgres,mysql}` | Selected search package | Maintain its disposable search projection |

The database adapter packages continue to publish only `dist`. They do not expose `migrate()`, publish Drizzle history, or auto-migrate at application boot.

Search is intentionally different. Each search package owns its schema and numbered migration stream because the search projection is disposable and belongs to that provider. The CLI must not merge search migrations into either database baseline.

### Baseline lifecycle

Before every release:

1. Generate and squash each adapter's Drizzle migrations to one `0000_*.sql` plus its single-entry `_journal.json`.
2. Run the CLI baseline-sync command.
3. Run the drift contract check.
4. Verify the CLI tarball contains both dialects.

Generated snapshot files remain in adapter source for `drizzle-kit generate`. The CLI does not copy them because Drizzle's runtime migrator reads only `_journal.json` and the journal-tagged SQL files.

### Native SQL lifecycle

Native SQL files are append-only after release. New upgrade work adds the next numbered script; it never edits a script present at an earlier release tag. The release workflow checks the current files against the preceding tag and fails if an already-released `.sql` file changed or disappeared.

Upgrade instructions point to the **target release** being installed. A CLI at version `X` therefore links to `vX/packages/db-<dialect>/sql/README.md`, not to `develop` and not ambiguously to the source version currently deployed.

### Empty means empty

The installer owns a dedicated PostgreSQL `public` schema or MySQL database. It will not merge a baseline into an application schema that already contains unrelated objects. Shared-schema adoption and conversion between dialects are outside this command's contract.

For classification:

- no tables or views → `empty`;
- any object whose lower-cased name starts with `byline_` → `byline-schema`;
- any other object, including `__drizzle_migrations` by itself → `occupied-schema`.

`__drizzle_migrations` alone is not proof of a Byline installation because unrelated Drizzle applications use the same default ledger name. All non-empty states are refused, so classification affects the explanation rather than the safety outcome.

## Current-state findings this plan must correct

- The CLI is hard-coded to PostgreSQL across `db`, `db-init`, environment, dependencies, Vite, and both server-config templates.
- `setup` performs dependency and environment checks before the database dialect is known.
- The current `db-init` flow mutates the role and installs `pgcrypto` before it runs migrations. Putting a probe only inside `runMigrations()` is too late.
- Changing the adapter's desired manifest version from `^X` to `X` is insufficient. The compatibility checker currently accepts any Byline range wholly inside the supported major, so an existing caret would be preserved.
- `packages/cli/README.md` and the live `setup --force` note still claim migrations can reapply as no-ops.
- `packages/cli/TODO.md` still proposes publishing Drizzle migrations from `@byline/db-postgres`, which contradicts this durable policy.
- The example scaffold contains two PostgreSQL-only maintenance scripts using `PgAdapter`; the MySQL adapter deliberately does not expose those maintenance methods.
- The existing draft's drift check could pass when the source gained a second SQL file but the bundled directory did not. The full source and bundle inventories must be compared.

## Proposed internal structure

```text
packages/cli/src/
  lib/database/
    dialect.ts                 DbDialect, defaults, flag validation, sticky selection
    state.ts                   database/schema object classification
    urls.ts                    dialect-aware URL parsing and application URL rendering
    provisioner.ts             DbProvisioner contract and registry
    postgres.ts                PostgreSQL inspect/provision/baseline implementation
    mysql.ts                   MySQL inspect/provision/baseline implementation
  lib/baseline.ts              dialect -> bundled baseline directory
  lib/baseline-drift.test.ts   full source/bundle inventory contract
  templates/
    migrations/
      postgres/
        0000_*.sql
        meta/_journal.json
      mysql/
        0000_*.sql
        meta/_journal.json
    byline/                    common minimal scaffold
    byline-examples/           common example overlay
    dialects/
      postgres/
        byline/server.config.ts
        byline-examples/server.config.ts
        byline-examples/scripts/backfill-version-locales.ts
        byline-examples/scripts/re-anchor.ts
      mysql/
        byline/server.config.ts
        byline-examples/server.config.ts
```

Template layers are merged in this order, with later layers replacing the same relative path:

1. `byline/`
2. `dialects/<dialect>/byline/`
3. `byline-examples/` when examples are enabled
4. `dialects/<dialect>/byline-examples/` when examples are enabled

This keeps common application files single-sourced while allowing the database-specific server config and PostgreSQL-only scripts to be explicit, valid TypeScript templates rather than token-filled source.

---

## Task 1: Add a first-class, sticky database dialect

**Files**

- Modify: `packages/cli/src/types.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/state.ts`
- Create: `packages/cli/src/lib/database/dialect.ts`
- Create/modify tests beside the affected modules

### Implementation

- Add `export type DbDialect = 'postgres' | 'mysql'`.
- Add `dbDialect?: DbDialect` to `Answers`.
- Add `--database <postgres|mysql>` to both `init` and `setup`, validate it in `cli.ts`, and carry it in the typed options and `Context.cliFlags`.
- Resolve the dialect in this order:
  1. a valid persisted `answers.dbDialect`;
  2. `--database`;
  3. an interactive select whose default/first choice is PostgreSQL.
- If both a persisted value and a flag exist and differ, return a blocked result explaining that changing dialect is a data migration, not an installer re-run. Do not overwrite the state.
- Treat state files written by every previously released CLI as PostgreSQL installations: when loading a non-empty version-1 state with completed database work but no `dbDialect`, migrate it in memory to `postgres` and rewrite on the next flush. A genuinely fresh state remains unset so it still prompts.
- Make `dbPhase.detect()` require a dialect in addition to its existing answers. Do not trust the completed-phase flag alone.
- Change `Context.secrets.superuserUrl` to the dialect-neutral `adminUrl`. Continue stripping the historical persisted `superuserUrl` field from old state files.

### Tests

- `--database mysql` and `--database postgres` validate; any other value fails before a phase runs.
- A fresh state prompts and persists the result.
- An old completed state without `dbDialect` migrates to PostgreSQL.
- A fresh empty state does not silently default in persisted state.
- A conflicting flag and persisted dialect blocks without modifying `.byline-install.json`.
- `doctor` uses the persisted dialect and never prompts.

### Commit

`feat(cli): added persistent database adapter selection`

---

## Task 2: Establish per-dialect baselines and a complete drift contract

**Files**

- Create: `packages/cli/src/lib/baseline.ts`
- Create: `packages/cli/src/lib/baseline-drift.test.ts`
- Create: `packages/cli/scripts/sync-db-baselines.mjs`
- Modify: `packages/cli/package.json`
- Replace: `packages/cli/src/templates/migrations/` with `postgres/` and `mysql/`

### Implementation

- Export `baselineDir(templatesDir, dialect)`.
- Add `pnpm --filter @byline/cli sync:baselines`, implemented by the script, which:
  - reads the selected source migration directory for each dialect;
  - asserts that the source has exactly one `.sql` file;
  - parses `_journal.json` and asserts exactly one entry;
  - asserts the journal tag equals the SQL basename;
  - recreates only that dialect's CLI baseline directory;
  - copies the SQL and `_journal.json`;
  - never copies snapshots.
- Keep the generated Drizzle filenames. Renaming to a generic filename would force the bundled journal to diverge from adapter source and weaken the byte-level contract.

### Drift test

For both dialects, assert:

- the source and bundle each contain exactly one SQL file;
- the complete SQL filename sets are equal;
- the source and bundle journals are byte-identical;
- the parsed journal contains one entry whose tag matches the SQL basename;
- corresponding SQL is byte-identical;
- the bundled `meta` directory contains only `_journal.json`;
- no unexpected files exist anywhere below the bundled dialect directory.

The test must fail if a second source migration is added, even if somebody copies only the updated journal.

### Verification

- Run the sync command.
- Run `pnpm --filter @byline/cli test`.
- Build the CLI and inspect `dist/templates/migrations`.
- Use a temporary fixture in the test for the negative drift case. Do not modify a tracked migration and restore it with `git checkout`.

### Commit

`feat(cli): bundled one verified baseline per database dialect`

---

## Task 3: Make dependency policy dialect-aware and enforce an exact adapter

**Files**

- Modify: `packages/cli/src/manifest/deps.ts`
- Modify: `packages/cli/src/lib/dependency-version.ts`
- Modify: `packages/cli/src/phases/deps.ts`
- Modify: `packages/cli/src/commands/setup-checks.ts`
- Modify: `packages/cli/src/phases/deps.test.ts`
- Modify: `packages/cli/src/phases/scaffold-smoke.test.ts`

### Manifest model

Extend `DepSpec` with:

```ts
dialects?: readonly DbDialect[]
versionPolicy?: 'supported-range' | 'exact'
```

Add `dependencySpecsFor(answers)` as the only production way to select required dependencies:

- specs without `dialects` apply to both;
- `@byline/db-postgres` applies only to PostgreSQL;
- `@byline/db-mysql` applies only to MySQL;
- `@byline/search-postgres` applies only to PostgreSQL and only when examples are enabled;
- `@byline/search-mysql` applies only to MySQL and only when examples are enabled;
- both database adapters use `CLI_PACKAGE_VERSION` and `versionPolicy: 'exact'`;
- other `@byline/*` packages retain `BYLINE_RELEASE_POLICY.dependencyRange`;
- unselected packages already present in the host manifest are left untouched.

The scaffold-smoke external inventory must use the selected dependency set rather than every manifest entry.

### Compatibility behavior

For `versionPolicy: 'exact'`:

- a registry declaration is compatible only when its normalized range is a subset of the exact `spec.version`;
- `4.9.0` is compatible with adapter `4.9.0`;
- `^4.9.0`, `~4.9.0`, `>=4.9.0 <5`, `4.9.x`, `4.9.1`, and `latest` are incompatible;
- an npm alias is accepted only when it points to the expected package at the exact version;
- a bare `workspace:*`, `workspace:^`, or `workspace:~` remains preserved, but the locally resolved package version must equal the CLI version exactly;
- an unresolved workspace link remains manual and blocks.

Do not special-case the adapter only in `depsPhase`; `setup` and future consumers must receive the same compatibility result from the shared checker.

### Tests

- The selected dialect installs only its adapter.
- Example mode installs the corresponding search package; minimal mode installs neither.
- A pre-existing adapter caret becomes an install/upgrade candidate.
- An exact registry version passes.
- A workspace link resolving to the exact version passes; a later same-major version blocks as manual.
- Setup checks use the selected set and do not demand PostgreSQL packages from a MySQL application.
- Existing common-package range tests continue to pass.

### Commit

`feat(cli): selected and exact-pinned database dependencies by dialect`

---

## Task 4: Make environment generation dialect-aware

**Files**

- Modify: `packages/cli/src/manifest/env.ts`
- Modify: `packages/cli/src/phases/env.ts`
- Modify: `packages/cli/src/commands/setup-checks.ts`
- Create: `packages/cli/src/lib/database/urls.ts`
- Add focused URL, environment, and setup-check tests

### Implementation

- Add `BYLINE_DB_MYSQL_CONNECTION_STRING` to `EnvKey`.
- Add optional `dialects` metadata to database `EnvSpec` entries.
- Export `envSpecsForDialect(dialect)` and use it in `envPhase` and setup checks.
- PostgreSQL writes and requires `BYLINE_DB_POSTGRES_CONNECTION_STRING`.
- MySQL writes and requires `BYLINE_DB_MYSQL_CONNECTION_STRING`.
- Preserve an existing unselected connection key; do not delete it.
- Render application URLs with `encodeURIComponent` for username, password, and database components:
  - `postgresql://...` with default port 5432;
  - `mysql://...` with default port 3306.
- Validate admin URLs by dialect and reject a PostgreSQL URL for MySQL or vice versa.
- Rename prompt text and descriptions so they say PostgreSQL or MySQL based on the selected dialect.

### Tests

- Reserved characters in usernames and passwords round-trip for both protocols.
- Each dialect writes only its selected required key into a clean fixture.
- Existing alternate-dialect keys are preserved.
- Setup checks report the selected key and ignore the unselected key.
- Missing `dbDialect` blocks environment planning rather than silently assuming PostgreSQL in a fresh state.

### Commit

`feat(cli): generated database environment by selected dialect`

---

## Task 5: Introduce testable PostgreSQL and MySQL provisioners

**Files**

- Create: `packages/cli/src/lib/database/provisioner.ts`
- Create: `packages/cli/src/lib/database/postgres.ts`
- Create: `packages/cli/src/lib/database/mysql.ts`
- Create: `packages/cli/src/lib/database/state.ts`
- Modify: `packages/cli/src/lib/pg-url.ts` or replace it through `urls.ts`
- Modify: `packages/cli/src/phases/db.ts`
- Modify: `packages/cli/src/context.ts`
- Modify: `packages/cli/package.json`
- Modify: `pnpm-lock.yaml`
- Add unit tests for both provisioners and state classification

### Provisioner contract

Define a small CLI-owned contract; do not import or expose migration behavior from `@byline/db-*`:

```ts
interface DbTargetInspection {
  exists: boolean
  objects: string[]
}

interface DbProvisioner {
  readonly dialect: DbDialect
  readonly defaultPort: number
  verifyAdminConnection(adminUrl: string): Promise<string>
  inspectTarget(adminUrl: string, database: string): Promise<DbTargetInspection>
  provisionTarget(args: ProvisionArgs): Promise<void>
  applyBaseline(args: BaselineArgs): Promise<void>
}
```

Keep the clients behind this seam so phase tests can inject fakes and assert call order without a live database.

### PostgreSQL implementation

- Preserve the existing `pg` implementation and identifier validation.
- Inspect database existence through the admin connection.
- For an existing database, connect as the administrator to the target and list tables and views in `public`.
- Only after an allowed `missing`/`empty` decision:
  - create or alter the application role;
  - create the database when missing, or ensure the empty database is owned/usable by the application role;
  - install `pgcrypto`;
  - run the selected baseline as the application role.
- Reset remains: terminate connections, drop, recreate, install extension, apply baseline.

### MySQL implementation

- Add `mysql2` as a direct CLI dependency because `db` and `db-init` run before the host dependency phase can provide it.
- Accept a `mysql://` administrator URL, normally rooted at `/mysql`.
- Verify `SELECT VERSION()` and reject MariaDB and MySQL older than 8.0.14 with the same user-facing contract as `@byline/db-mysql`.
- Inspect existence through `information_schema.SCHEMATA`; inspect tables and views through `information_schema.TABLES` for the selected schema.
- Escape identifiers with mysql2's identifier escape and user/password values as SQL literals. Retain conservative identifier validation; apply MySQL's 32-character account-name limit to `dbUser`.
- Provision:
  - `CREATE USER IF NOT EXISTS '<user>'@'%'`;
  - `ALTER USER ... IDENTIFIED BY ...`;
  - create the database as `utf8mb4 COLLATE utf8mb4_0900_ai_ci` when missing;
  - grant privileges on the selected database;
  - do not install extensions or shell out to the `mysql` client.
- Reset drops and recreates the selected database only after the existing double confirmation.
- Apply the MySQL baseline with a one-connection mysql2 promise pool, `timezone: 'Z'`, `drizzle-orm/mysql2`, and its migrator; always close the pool.

### Database phase

- Resolve/prompt the dialect before connection details.
- Make strategy and credential prompts dialect-specific.
- Keep Docker as an explicitly unsupported strategy for both dialects in this release.
- Test the administrator connection through the selected provisioner.
- Persist only host, port, database, user, strategy, and dialect. Keep the administrator URL and application password in memory.

### Tests

- State classification covers empty, Byline objects, unrelated objects, mixed objects, case differences, views, and `__drizzle_migrations` alone.
- PostgreSQL and MySQL URL/protocol validation is strict.
- MySQL version checks cover 8.0.13, 8.0.14, 8.x/9.x, MariaDB, and malformed output.
- Query/escaping helpers are tested with quotes and reserved characters.
- Neither implementation shells out.

### Commit

`feat(cli): added PostgreSQL and MySQL database provisioners`

---

## Task 6: Gate all mutation on authoritative target inspection

**Files**

- Refactor: `packages/cli/src/phases/db-init.ts`
- Create: `packages/cli/src/phases/db-init.test.ts`
- Modify: `packages/cli/src/commands/setup.ts`

### Required execution order

For a non-reset run:

1. Resolve the selected provisioner and administrator URL.
2. Inspect whether the target database exists and list its schema objects.
3. Classify the target.
4. If it is `byline-schema` or `occupied-schema`, print the appropriate refusal and return `blocked`.
5. Only for `missing` or `empty`, resolve/create credentials, provision the principal/database, install dialect-specific prerequisites, and apply the selected baseline.

For a reset run:

1. Require the existing double confirmation.
2. Provisioner drops/recreates only the named target.
3. Apply prerequisites and the selected fresh baseline.

Do not place the safety probe inside `runMigrations()`. By then role/user and extension mutations have already happened.

### Refusal behavior

- Byline schema: explain that a squashed baseline is not an upgrade and link to:

  ```text
  https://github.com/Byline-CMS/bylinecms.dev/blob/v<CLI_PACKAGE_VERSION>/packages/db-<dialect>/sql/README.md
  ```

- Occupied schema: explain that the installer requires a dedicated empty schema/database.
- Say “target release” in the upgrade message.
- Recommend `byline setup --force --reset --i-mean-it` only when destroying and rebuilding is intended.
- `--force` changes phase detection only; it never changes the database-state decision.

### Automated tests

Using fake provisioners, prove:

- missing target → provision then baseline;
- empty target → provision/permissions then baseline;
- Byline target → blocked and no provision/baseline call;
- occupied target → blocked and no provision/baseline call;
- `--force` plus occupied target → still blocked;
- reset → inspect may be skipped, destructive provision then baseline;
- PostgreSQL alone receives the extension step;
- the baseline path matches the selected dialect;
- the upgrade URL is tag-pinned and dialect-correct.

Update the live `setup --force` note in the same task. It must say that a forced database phase still refuses occupied databases and that resetting is destructive; it must not say migrations may be no-ops.

### Commit

`feat(cli): refused fresh baselines before any occupied-database mutation`

---

## Task 7: Scaffold the selected adapter and search provider

**Files**

- Refactor: `packages/cli/src/phases/scaffold.ts`
- Move database-specific templates under `packages/cli/src/templates/dialects/`
- Add MySQL minimal and example `server.config.ts` templates
- Modify common example comments that unnecessarily name PostgreSQL
- Modify: `packages/cli/src/templates/host/vite.config.ts`
- Modify: `packages/cli/src/phases/wire/vite-config.ts`
- Modify scaffold and template-contract tests

### Server templates

The PostgreSQL templates retain:

- `pgAdapter`;
- `@byline/db-postgres/admin`;
- PostgreSQL pool options;
- in example mode, `migrate` and `postgresSearch` from `@byline/search-postgres`;
- the two PostgreSQL-only maintenance scripts.

The MySQL templates use:

- `mysqlAdapter`;
- `@byline/db-mysql/admin`;
- `BYLINE_DB_MYSQL_CONNECTION_STRING`;
- MySQL pool options (`connectionLimit`, `idleTimeout`, `connectTimeout`);
- in example mode, `migrate` and `mysqlSearch` from `@byline/search-mysql`;
- the adapter's existing pool for search migration and provider construction.

Both example templates retain the current defensive search-migration behavior: await the selected package's `migrate(pool)` at startup, log loudly on failure, and continue without taking down the application.

Do not copy `backfill-version-locales.ts` or `re-anchor.ts` for MySQL. They call maintenance methods deliberately absent from `MySqlAdapter`; copying them would produce an invalid scaffold.

Rewrite common collection comments to describe the configured database/search provider rather than claiming PostgreSQL.

### Vite

- Make the canonical config safe for either database by externalizing both `@byline/db-postgres` and `@byline/db-mysql` where the existing PostgreSQL package is externalized.
- Keep a single host Vite template rather than selecting one per dialect.
- Add the current canonical hash to `PREDECESSOR_HASHES` before changing the template so an untouched prior CLI config can be backed up and upgraded.
- Add tests for exact-current, recognized-predecessor, and divergent-user-config behavior.

### Scaffold tests

Expand the smoke matrix across both dialects and the existing example/import-doc combinations. Assert:

- all bare imports are covered by the selected dependency manifest;
- PostgreSQL fixtures contain no MySQL packages or env key;
- MySQL fixtures contain no PostgreSQL packages or env key;
- the chosen search package appears only with examples;
- MySQL inventories omit PostgreSQL-only scripts;
- hooks, generated types, custom route paths, and local imports remain valid.

### Commit

`feat(cli): scaffolded PostgreSQL or MySQL runtime configuration`

---

## Task 8: Make setup and doctor selection-aware

**Files**

- Modify: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/commands/setup-checks.ts`
- Modify: `packages/cli/src/commands/doctor.ts` if needed
- Add setup-flow tests

### Implementation

- In `setup`, run the non-mutating `db` selection/connection phase after preflight and before dependency/environment checks. Then run setup checks, followed by `db-init` and the selected seed phases.
- Do not run `db` a second time in the later phase list.
- Filter dependency and environment checks through the persisted selected dialect.
- If a manually wired application's state is absent, `setup --database mysql` provides deterministic non-interactive selection.
- If no state and no flag exist, prompt before checks.
- Keep seed execution database-independent through the selected scaffolded `server.config.ts`.
- `doctor` must report a fresh/missing dialect as pending rather than assuming PostgreSQL, while an upgraded old state is recognized as PostgreSQL.

### Tests

- MySQL setup accepts MySQL dependencies and env without demanding PostgreSQL equivalents.
- PostgreSQL setup behavior remains unchanged.
- Setup obtains the dialect before checks.
- A blocked `db-init` prevents either seed phase.
- A normal rerun with recorded `db-init` skips it; `--force` re-enters it and therefore still observes the occupied-database guard.

### Commit

`feat(cli): made setup and doctor database-aware`

---

## Task 9: Enforce release invariants and add bounded CI smoke coverage

**Files**

- Create: `scripts/check-native-sql-history.mjs`
- Modify: `.agents/skills/release/SKILL.md`
- Modify: `.claude/commands/release.md`
- Modify: `.opencode/commands/release.md`
- Add: `packages/cli` integration-test configuration and database smoke tests
- Modify: `packages/cli/package.json`
- Modify: `turbo.json`
- Modify: `.github/workflows/ci.yml`
- Add a changeset for the CLI/MySQL GA release

### Native SQL release guard

Add a repository script accepting `--base v<previous-version>` that:

- lists `packages/db-postgres/sql/*.sql` and `packages/db-mysql/sql/*.sql` at the base tag;
- fails if any previously tagged SQL file is deleted or byte-changed;
- allows new numbered SQL files;
- ignores README changes.

Add the guard and baseline-sync/check sequence to all three maintained release instruction surfaces. The release sequence must:

1. verify both adapter Drizzle sources are single squashed baselines;
2. run the CLI baseline sync;
3. run the baseline drift test;
4. run the native SQL history guard against the previous release tag;
5. continue with versioning, build, pack, and publish only when those checks pass.

### CLI integration smoke

Add one integration file for the CLI and run it in the existing `test-suite` job, reusing the already-running PostgreSQL and MySQL services. Do not add another job or matrix.

Provide separate administrator URLs and unique `_test` database names:

- PostgreSQL administrator connection to the service's administrative database;
- MySQL root connection to the service's `mysql` database.

For each dialect:

1. create/provision a fresh target and apply the selected bundled baseline;
2. assert a canonical Byline table exists;
3. rerun inspection and assert it classifies as Byline and refuses a baseline;
4. create a separate target containing one unrelated table;
5. assert refusal and verify no Byline table appeared;
6. for PostgreSQL, verify the refusal happened before `pgcrypto` was installed in that occupied target;
7. clean up only the explicitly named CLI test databases/users in `afterAll`.

The existing MySQL 8.0 service is the GA floor. The existing adapter-only non-UTC rerun remains sufficient for temporal coverage; do not repeat the CLI smoke under the alternate timezone.

### Published artifact check

Build and inspect the package tarball programmatically. Assert these entries exist:

- `dist/templates/migrations/postgres/<tag>.sql`
- `dist/templates/migrations/postgres/meta/_journal.json`
- `dist/templates/migrations/mysql/<tag>.sql`
- `dist/templates/migrations/mysql/meta/_journal.json`

Assert no snapshot is present.

### Full gates

Run from the repository root, in authoritative CI order where applicable:

```bash
pnpm byline:generate:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm test
pnpm test:integration
pnpm build
git diff --check
```

Then run the CLI tarball contract check and inspect the changeset status.

### Commit

`test(cli): covered PostgreSQL and MySQL installation policy`

---

## Task 10: Document the final installation and upgrade contract

**Files**

- Modify: `docs/01-getting-started/01-cli.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/cli/TODO.md`
- Modify: `packages/db-mysql/README.md`
- Modify: `packages/db-mysql/sql/README.md`
- Modify: `packages/db-postgres/sql/README.md`
- Modify: `docs/03-architecture/01-document-storage.md`
- Modify: `docs/06-search/06-postgres-and-mysql.md`
- Update any other search result that still calls MySQL preliminary or PostgreSQL-only

### Required documentation changes

- Document interactive selection and `--database postgres|mysql`.
- Show the selected environment key and package/config result for each dialect.
- Replace every claim that `--force` safely reapplies database migrations as no-ops.
- Explain:
  - fresh database → CLI baseline;
  - intentional rebuild → `--reset --i-mean-it`;
  - existing installation → numbered native SQL at the target release tag.
- State that the CLI refuses both an existing Byline schema and unrelated occupied schema before mutation.
- Explain that each release squashes its Drizzle baseline and that it is not an upgrade history.
- In PostgreSQL upgrade docs, retain the ownership-guard instructions.
- In MySQL upgrade docs, explicitly retain the “no ownership guard” rule and MySQL's non-transactional DDL caveat.
- Remove the stale claim that MySQL has no released versions.
- Remove the MySQL “preliminary/no CLI support” status after all implementation and CI tasks pass.
- Keep PostgreSQL as the default choice without describing MySQL as second-class.
- Keep benchmarking listed as useful non-blocking characterization work.
- Replace both `packages/cli/TODO.md` proposals to publish adapter Drizzle migrations with the durable bundled-baseline/native-SQL policy.

Do not ship documentation promising the occupied-database refusal before Task 6 lands. Documentation and behavior may be separate commits on the feature branch, but they must enter a release together.

### Verification

- `pnpm docs:check`
- `git diff --check`
- Search for stale phrases: `migrations re-apply as no-ops`, `No CLI support`, `Postgres only`, `preliminary`, and `has no released versions yet`.

### Commit

`docs: documented MySQL installation and database upgrade policy`

---

## Explicit non-goals

- The CLI will not apply native SQL upgrades automatically.
- The database adapters will not expose a public migration API.
- Drizzle migrations will not be published from `@byline/db-postgres` or `@byline/db-mysql`.
- Database conversion between PostgreSQL and MySQL is not supported.
- Adoption of a shared or already-populated schema is not supported.
- Docker database provisioning remains stubbed.
- MariaDB remains unsupported.
- MySQL benchmark work remains non-blocking.
- Search migrations will not be copied into the CLI baseline.
- PostgreSQL-only maintenance methods will not be added to MySQL merely to make example scripts appear symmetrical.

## Implementation order and release boundary

Tasks 1–8 are one functional chain. Task 9 proves the release and CI boundary, and the GA documentation lands last in Task 10. Intermediate commits are useful for review, but no release should contain only part of the chain.

The minimum release-ready boundary is:

- dialect selection;
- exact selected dependency policy;
- selected environment and templates;
- both provisioners;
- pre-mutation occupied-database refusal;
- both verified baselines;
- setup/doctor awareness;
- bounded live smoke coverage;
- corrected GA and upgrade documentation.

At that boundary, issue #58's CLI criterion can be checked off and the MySQL adapter can be described as generally available.
