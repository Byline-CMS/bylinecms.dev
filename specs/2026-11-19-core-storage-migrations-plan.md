---
title: "Adapter-owned core storage migrations"
path: "core-storage-migrations-plan"
summary: "Move core database installation and upgrades to adapter-owned SQL journals, starting with the PostgreSQL installer conflict and a supervised cutover for existing installations."
---

# Adapter-owned core storage migrations

Companions:

- [July CLI baseline policy](./2026-07-27-cli-migration-baseline-policy-plan.md) records the dedicated-database installer contract this proposal would revise.
- [Drizzle-free adapters analysis](./2026-07-24-drizzle-free-adapters-analysis.md) and [#43](https://github.com/Byline-CMS/bylinecms.dev/issues/43) cover the separate question of replacing Drizzle in the adapters.
- [#105](https://github.com/Byline-CMS/bylinecms.dev/issues/105) tracks the PostgreSQL journal conflict. [#73](https://github.com/Byline-CMS/bylinecms.dev/issues/73) tracks development databases affected by release squashes.

**Status** · Draft for discussion, 2026-11-19. The first implementation step is to settle the cutover contract below in a companion specification. Command and journal names here are proposals.

## Objective and starting point

Give operators one way to determine which core storage schema is installed and apply the next supported change. Each database adapter owns its SQL and records its progress. The CLI calls the selected adapter. Drizzle remains available for schema definition, generation and queries. Search and analytics retain their independent journals.

Today the CLI applies a release baseline through Drizzle, and the PostgreSQL path uses the default journal shared with other Drizzle applications. Existing Byline databases follow hand-applied SQL streams. At the reviewed revision PostgreSQL has scripts through 0015 and MySQL through 0010. These numbers belong to different histories. The CLI currently refuses occupied targets before provisioning and recognizes any object beginning with `byline_` as evidence of Byline. An analytics-only database can therefore look like a core installation. The test database helpers also use Drizzle's migrator.

For an existing installation, the operator identifies the adapter, release, manually applied scripts and recovery point before cutover. Read-only inspection determines whether the database matches a supported checkpoint. An unrecognized database needs a specific diagnosis and a documented route to a recognized checkpoint.

Implementation references: [CLI initialization](../packages/cli/src/phases/db-init.ts), [target classification](../packages/cli/src/lib/database/state.ts), [PostgreSQL upgrades](../packages/db-postgres/sql/README.md), [MySQL upgrades](../packages/db-mysql/sql/README.md), [analytics PostgreSQL runner](../packages/analytics-postgres/src/migrate.ts).

## Decisions for the companion spec

1. **Baseline and version numbering.** Choose the per-dialect cutover revision and define which numbered steps a fresh baseline includes. A release squash must never renumber an installed migration. Decide whether to retain release snapshots or freeze a cutover baseline and apply subsequent steps on fresh installs. Require installed and upgraded databases to converge under either scheme.
2. **Adoption evidence.** Define the schema objects, constraints and any data postconditions sufficient to recognize the supported checkpoint. A package version, a host Drizzle timestamp or a Byline-prefixed table alone is insufficient. For older supported databases, document the steps to reach the checkpoint. A partial or ambiguous schema should yield a specific discrepancy.
3. **Operator contract.** Define adapter operations for read-only status, installation, explicit adoption and migration. Specify journal placement, permissions, lock scope, behavior on a newer schema and the startup compatibility window. Decide whether any additive migration merits opt-in startup application. Default proposal: startup checks compatibility and reports the required action before serving content.
4. **Distribution and rollback.** Decide how the CLI resolves the matching adapter's runner and SQL from published packages, including before server configuration can load. Document what can roll back with code alone and when a fenced restore is required. Existing boot checks, including revision-schema validation, continue to cover the invariants they verify.

## Delivery sequence

### 1. Fix PostgreSQL installation and isolate the journal

- Give `@byline/db-postgres` a server-only installer and a core-owned journal (proposed name `byline_core_migrations`). Execute baseline and pending steps on the locked connection. For transactional steps, commit the SQL and journal record together. Use a lock distinct from those for search and analytics.
- Keep dedicated provisioning as the default. Provide an explicit existing-database path using the supplied connection. Inspect for collisions with the actual baseline objects, including unprefixed names, before mutation. Keep database ownership changes, role provisioning and destructive reset out of this path. The host's journal belongs to the host.
- Route the PostgreSQL CLI and test bootstrap through the same installer. Preserve migration records during test truncation. Verify the packed CLI and adapter contain or can resolve the SQL they run.
- **Release criterion:** in an integration fixture, install host Drizzle and Byline in both orders, then advance each independently. Verify both migrations ran, unrelated objects and ownership survived, concurrent installers applied the baseline once, and retry is safe. Existing dedicated setup, refusal and reset behavior still pass. This fixes #105 independently of a query-layer rewrite.

### 2. Adopt existing PostgreSQL databases and expose upgrade status

- Implement read-only inspection before introducing a startup requirement. Distinguish fresh, existing host-only, recognized unjournaled core, journaled current or pending, and incompatible states. Include analytics/search-only and partial installs in fixtures.
- On explicit adoption, verify the supported checkpoint under the migration lock and record it once. Present the result as a verified baseline checkpoint. Preserve historical evidence about manually applied scripts and leave the old Drizzle journal intact. Never automatically replay the legacy stream: several PostgreSQL scripts contain transaction boundaries and ownership guards covering unrelated objects in `public`.
- Add explicit CLI status and migrate operations. Wire a read-only compatibility check into supported startup paths before document traffic or workers begin. An ordinary application role should be able to boot a compatible database without DDL privileges. A migration that changes the writer contract requires an operator-led cutover with old writers and workers fenced.
- **Release criterion:** rehearse adoption on a restored supported installation. Prove a second adoption changes nothing, pending steps resume correctly, incompatible schemas produce actionable diagnostics, and a failed transactional step leaves neither schema changes nor a journal entry. Coordinate adoption before enabling mandatory startup checks in an existing deployment.

### 3. Implement the same operator contract for MySQL

- Use MySQL-specific SQL, checkpoint evidence and a connection-scoped migration lock. MySQL DDL can commit before the journal advances. Verify each completed step's postconditions and design retry to resume or report the exact partial state. Apply this to initial installation as well as upgrades.
- Switch the MySQL CLI and test helper together. Run equivalent install, adoption, compatibility, concurrency and recovery scenarios on the supported MySQL 8.0 line. Include an interrupted DDL sequence and the gap between successful DDL and journal insertion.
- **Release criterion:** the same operator actions produce equivalent outcomes on both engines, including a repeatable diagnosis after interruption. Keep independently releasable PostgreSQL work moving while this is implemented.

### 4. Land release tooling and supervised rollout

- Update package artifact checks, baseline synchronization or its replacement, released-SQL immutability checks and release instructions as each adapter switches. Preserve older release-tag instructions for installations still reaching the checkpoint. Verify a fresh install and an upgrade produce equivalent core schema and preserve representative content and workflow state.
- Document dedicated install, shared-database install, adoption, startup diagnostics and upgrade recovery. Rehearse with a backup the team can restore, then check application startup, document read/write and unchanged host migration state after cutover.

## Restart point after housekeeping

Recheck the branch, #105 and any installer or release-tooling changes since this draft. Compare the current per-dialect baselines with the released native upgrade scripts and representative upgrade fixtures. Use that evidence to choose the checkpoint and write the companion spec. The first implementation deliverable is the PostgreSQL coexistence fixture and isolated install path in stage 1.
