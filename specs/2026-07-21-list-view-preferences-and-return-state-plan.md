# List-View Preferences and Return-to-List State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user DB-persisted list-view preferences (`page_size` + default sort) for collection lists (issue #16), and a `from`-param return-to-list mechanism so closing a document lands back on the exact list page/filter the user came from (issue #17).

**Architecture:** A new scoped key-value table `byline_admin_user_preferences` behind an `admin-preferences` module in `@byline/admin` (self-service commands, mirroring `admin-account`), a Postgres repository in `@byline/db-postgres/admin`, and server-side preference application inside the existing `getCollectionDocuments` server fn (same place `defaultSort` applies — SSR-correct, no flicker). Return-to-list needs no storage: the editor carries a URL-encoded `from` search param and navigates back to it on close/delete.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Zod v4, TanStack Start server fns + Router, Vitest.

**Spec:** `specs/2026-07-21-list-view-preferences-and-return-state-design.md` (approved 2026-07-21). Precedence chain: `URL params → user preference → defaultSort → created_at desc`.

## Global Constraints

- Every new source file starts with the MPL-2.0 header block (copy it verbatim from any sibling file; it names "Infonomic Company Limited").
- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char lines, ES5 trailing commas. Run `pnpm lint` (repo root) to auto-fix before each commit. Never introduce ESLint/Prettier.
- Import ordering (Biome-enforced): Node builtins → React → TanStack → packages (`@byline/*` etc.) → local relative, blank-line separated.
- Commits: conventional format `type(scope): lowercase past-tense message`, single line. **NO Co-Authored-By, no AI-attribution, no trailers of any kind** (see `.claude/rules/conventional-commits.md` and `.claude/skills/git-commit/SKILL.md`).
- Monorepo: pnpm + Turborepo. Run package-local tests with `cd packages/<pkg> && pnpm test`. `pnpm typecheck` at the root covers the workspace.
- Internal imports between `@byline/*` packages use the package name, never relative paths across packages. Within a package, relative imports use the `.js` extension (ESM).
- Integration tests need the `byline_test` database (one-time `pnpm db:init:test`; the runner auto-migrates). The dev database is assumed running (Docker, `postgres/postgres.sh up -d`).
- Preferences are **self-service only**: every command sources the target user id from `actor.id` on the authenticated `RequestContext`. No request schema accepts a user id.
- Preference failures never break the list: read failures log and fall through to defaults; client-side write failures `console.warn` only.

---

### Task 0: Feature branch

**Files:** none (git only)

- [ ] **Step 0.1: Create the branch**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
git checkout develop
git checkout -b feat/list-view-preferences
```

Expected: `Switched to a new branch 'feat/list-view-preferences'`. All subsequent commits land here.

---

### Task 1: `admin-preferences` module in `@byline/admin`

**Files:**
- Create: `packages/admin/src/modules/admin-preferences/schemas.ts`
- Create: `packages/admin/src/modules/admin-preferences/schemas.test.node.ts`
- Create: `packages/admin/src/modules/admin-preferences/repository.ts`
- Create: `packages/admin/src/modules/admin-preferences/service.ts`
- Create: `packages/admin/src/modules/admin-preferences/commands.ts`
- Create: `packages/admin/src/modules/admin-preferences/index.ts`
- Modify: `packages/admin/src/store.ts`
- Modify: `packages/admin/package.json` (BOTH the top-level `exports` and `publishConfig.exports` blocks — the `exports-parity.test.node.ts` test fails if they drift)

**Interfaces:**
- Consumes: `createCommand` / `Command` from `packages/admin/src/lib/create-command.js`; `AdminStore` from `packages/admin/src/store.js`.
- Produces (later tasks rely on these exact names):
  - `interface AdminUserPreferenceRow { user_id: string; scope: string; value: Record<string, unknown>; created_at: Date; updated_at: Date }`
  - `interface AdminPreferencesRepository { get(userId: string, scope: string): Promise<AdminUserPreferenceRow | null>; upsert(userId: string, scope: string, patch: Record<string, unknown>): Promise<AdminUserPreferenceRow> }`
  - `getPreferenceCommand(context, { scope }, { store })` → `Promise<{ scope: string; value: Record<string, unknown> | null }>`
  - `setPreferenceCommand(context, { scope, value }, { store })` → same response shape
  - `AdminStore` gains `adminPreferences: AdminPreferencesRepository`
  - Subpath export `@byline/admin/admin-preferences`

- [ ] **Step 1.1: Write the failing schema tests**

`packages/admin/src/modules/admin-preferences/schemas.test.node.ts` (MPL header first, as in every file — omitted in plan listings from here on for brevity, but REQUIRED in the actual files):

```ts
import { describe, expect, it } from 'vitest'

import {
  listViewPreferenceValueSchema,
  preferenceScopeSchema,
  setPreferenceRequestSchema,
} from './schemas.js'

describe('preferenceScopeSchema', () => {
  it('accepts dot-separated scope keys', () => {
    expect(preferenceScopeSchema.safeParse('collections.docs.list').success).toBe(true)
    expect(preferenceScopeSchema.safeParse('collections.media-items.list').success).toBe(true)
  })

  it('rejects empty, spaced, and slash-separated keys', () => {
    expect(preferenceScopeSchema.safeParse('').success).toBe(false)
    expect(preferenceScopeSchema.safeParse('has space').success).toBe(false)
    expect(preferenceScopeSchema.safeParse('a/b').success).toBe(false)
  })
})

describe('listViewPreferenceValueSchema', () => {
  it('accepts a page_size-only payload (partial writes are the norm)', () => {
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 50 }).success).toBe(true)
  })

  it('accepts a sort-only payload', () => {
    expect(listViewPreferenceValueSchema.safeParse({ order: 'title', desc: true }).success).toBe(
      true
    )
  })

  it('enforces the 1-100 page_size bounds', () => {
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 0 }).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 101 }).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 12.5 }).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 1 }).success).toBe(true)
    expect(listViewPreferenceValueSchema.safeParse({ page_size: 100 }).success).toBe(true)
  })

  it('rejects an empty payload and unknown keys', () => {
    expect(listViewPreferenceValueSchema.safeParse({}).success).toBe(false)
    expect(listViewPreferenceValueSchema.safeParse({ page: 7 }).success).toBe(false)
  })
})

describe('setPreferenceRequestSchema', () => {
  it('requires both scope and a non-empty value', () => {
    expect(
      setPreferenceRequestSchema.safeParse({
        scope: 'collections.docs.list',
        value: { page_size: 30 },
      }).success
    ).toBe(true)
    expect(
      setPreferenceRequestSchema.safeParse({ scope: 'collections.docs.list', value: {} }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
cd packages/admin && pnpm vitest run --mode=node src/modules/admin-preferences/schemas.test.node.ts
```

Expected: FAIL — `Cannot find module './schemas.js'` (or equivalent resolution error).

- [ ] **Step 1.3: Implement the schemas**

`packages/admin/src/modules/admin-preferences/schemas.ts`:

```ts
/**
 * Zod schemas for the admin-preferences commands.
 *
 * Self-service, like admin-account: none of the request schemas accept a
 * user id — the command resolves the target from `actor.id`.
 *
 * The `value` payload is validated against the list-view shape because
 * that is the only registered scope family today
 * (`collections.<path>.list`). When a second scope family arrives, this
 * becomes a scope-keyed selection of value schemas.
 */

import { z } from 'zod'

/** Dot-separated segment key, e.g. `collections.docs.list`. */
export const preferenceScopeSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/i, {
    message: 'scope must be dot-separated segments of [a-z0-9_-]',
  })

/**
 * Sticky list-view keys. All optional — clients send only the keys the
 * interaction changed, and the repository merges per-key — but an empty
 * object is rejected (nothing to write).
 */
export const listViewPreferenceValueSchema = z
  .object({
    page_size: z.number().int().min(1).max(100).optional(),
    order: z.string().min(1).max(255).optional(),
    desc: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'value cannot be empty' })

export const getPreferenceRequestSchema = z.object({
  scope: preferenceScopeSchema,
})
export type GetPreferenceRequest = z.infer<typeof getPreferenceRequestSchema>

export const setPreferenceRequestSchema = z.object({
  scope: preferenceScopeSchema,
  value: listViewPreferenceValueSchema,
})
export type SetPreferenceRequest = z.infer<typeof setPreferenceRequestSchema>

/** `value` is `null` when the user has no stored preference for the scope. */
export const preferenceResponseSchema = z.object({
  scope: z.string(),
  value: z.record(z.string(), z.unknown()).nullable(),
})
export type PreferenceResponse = z.infer<typeof preferenceResponseSchema>
```

- [ ] **Step 1.4: Run the test to verify it passes**

```bash
cd packages/admin && pnpm vitest run --mode=node src/modules/admin-preferences/schemas.test.node.ts
```

Expected: PASS (all tests green).

- [ ] **Step 1.5: Write the repository interface, service, commands, and barrel**

`packages/admin/src/modules/admin-preferences/repository.ts`:

```ts
/**
 * `AdminPreferencesRepository` — the DB-adapter-facing contract for the
 * `byline_admin_user_preferences` table: a scoped per-user key-value
 * store. One row per (user, scope); `value` is a JSONB object whose
 * shape is owned by the scope's feature (validated at the command
 * layer, not here).
 *
 * Adapters (e.g. `@byline/db-postgres`) implement this interface; the
 * admin-preferences service consumes it via the `AdminStore` bundle.
 */

export interface AdminUserPreferenceRow {
  user_id: string
  scope: string
  value: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

export interface AdminPreferencesRepository {
  /** `null` when the user has no row for the scope. */
  get(userId: string, scope: string): Promise<AdminUserPreferenceRow | null>
  /**
   * Insert-or-merge. On conflict the JSONB `patch` is merged into the
   * stored value **per key** (`value || patch`), so writing
   * `{ page_size }` preserves a previously stored `order`/`desc`.
   * Vid-less — preferences are last-writer-wins by design.
   */
  upsert(
    userId: string,
    scope: string,
    patch: Record<string, unknown>
  ): Promise<AdminUserPreferenceRow>
}
```

`packages/admin/src/modules/admin-preferences/service.ts`:

```ts
/**
 * Self-service business logic for per-user admin preferences. Every
 * method takes `actorId` sourced server-side from the authenticated
 * `RequestContext` — callers cannot supply a target user id.
 */

import type { AdminPreferencesRepository } from './repository.js'
import type { PreferenceResponse } from './schemas.js'

export class AdminPreferencesService {
  readonly #repo: AdminPreferencesRepository

  constructor(deps: { repo: AdminPreferencesRepository }) {
    this.#repo = deps.repo
  }

  async getPreference(actorId: string, scope: string): Promise<PreferenceResponse> {
    const row = await this.#repo.get(actorId, scope)
    return { scope, value: row?.value ?? null }
  }

  async setPreference(
    actorId: string,
    scope: string,
    patch: Record<string, unknown>
  ): Promise<PreferenceResponse> {
    const row = await this.#repo.upsert(actorId, scope, patch)
    return { scope, value: row.value }
  }
}
```

`packages/admin/src/modules/admin-preferences/commands.ts`:

```ts
/**
 * Transport-agnostic commands for per-user admin preferences.
 *
 * Same self-service posture as admin-account: `auth` is
 * `{ authenticated: true }` (no ability key), and the security property
 * "you may only touch your own preferences" is structural — the target
 * id comes from `actor.id`, never from the request payload.
 */

import { type Command, createCommand } from '../../lib/create-command.js'
import {
  getPreferenceRequestSchema,
  preferenceResponseSchema,
  setPreferenceRequestSchema,
} from './schemas.js'
import { AdminPreferencesService } from './service.js'
import type { AdminStore } from '../../store.js'
import type {
  GetPreferenceRequest,
  PreferenceResponse,
  SetPreferenceRequest,
} from './schemas.js'

export interface AdminPreferencesCommandDeps {
  store: AdminStore
}

function serviceOf(deps: AdminPreferencesCommandDeps): AdminPreferencesService {
  return new AdminPreferencesService({ repo: deps.store.adminPreferences })
}

export const getPreferenceCommand: Command<
  GetPreferenceRequest,
  PreferenceResponse,
  AdminPreferencesCommandDeps
> = createCommand({
  method: 'getPreference',
  auth: { authenticated: true },
  schemas: { input: getPreferenceRequestSchema, output: preferenceResponseSchema },
  handler: ({ input, deps, actor }) => serviceOf(deps).getPreference(actor.id, input.scope),
})

export const setPreferenceCommand: Command<
  SetPreferenceRequest,
  PreferenceResponse,
  AdminPreferencesCommandDeps
> = createCommand({
  method: 'setPreference',
  auth: { authenticated: true },
  schemas: { input: setPreferenceRequestSchema, output: preferenceResponseSchema },
  handler: ({ input, deps, actor }) =>
    serviceOf(deps).setPreference(actor.id, input.scope, input.value),
})
```

Before finalising this step, open `packages/admin/src/lib/create-command.ts` and confirm the `createCommand` option names used above (`method`, `auth: { authenticated: true }`, `schemas: { input, output }`, `handler({ input, deps, actor })`) match — they are copied from `admin-account/commands.ts`, so any mismatch means that file changed and you should mirror its current shape.

`packages/admin/src/modules/admin-preferences/index.ts`:

```ts
/**
 * `@byline/admin/admin-preferences` — scoped per-user key-value
 * preferences for the currently signed-in admin user.
 *
 * Self-service like `@byline/admin/admin-account`: the actor IS the
 * target, and there is no ability gate — authn-only. The `scope` string
 * (e.g. `collections.docs.list`) is the generality lever: new admin
 * surfaces claim their own scopes with no schema change.
 */

export { getPreferenceCommand, setPreferenceCommand } from './commands.js'
export {
  getPreferenceRequestSchema,
  listViewPreferenceValueSchema,
  preferenceResponseSchema,
  preferenceScopeSchema,
  setPreferenceRequestSchema,
} from './schemas.js'
export { AdminPreferencesService } from './service.js'
export type { AdminPreferencesCommandDeps } from './commands.js'
export type {
  AdminPreferencesRepository,
  AdminUserPreferenceRow,
} from './repository.js'
export type {
  GetPreferenceRequest,
  PreferenceResponse,
  SetPreferenceRequest,
} from './schemas.js'
```

- [ ] **Step 1.6: Add the repository to `AdminStore`**

In `packages/admin/src/store.ts`, add the import and interface member, and update the "four repositories" wording in the doc comment to "five":

```ts
import type { AdminPreferencesRepository } from './modules/admin-preferences/repository.js'
```

```ts
export interface AdminStore {
  adminUsers: AdminUsersRepository
  adminRoles: AdminRolesRepository
  adminPermissions: AdminPermissionsRepository
  refreshTokens: RefreshTokensRepository
  adminPreferences: AdminPreferencesRepository
}
```

- [ ] **Step 1.7: Add the subpath export (both blocks)**

In `packages/admin/package.json`, add to the top-level `exports` map (alphabetical position beside `./admin-account`) AND to `publishConfig.exports`:

```json
"./admin-preferences": {
  "types": "./dist/modules/admin-preferences/index.d.ts",
  "import": "./dist/modules/admin-preferences/index.js",
  "require": "./dist/modules/admin-preferences/index.js"
}
```

- [ ] **Step 1.8: Run the package tests and workspace typecheck**

```bash
cd packages/admin && pnpm test
cd ../.. && pnpm typecheck
```

Expected: `packages/admin` tests PASS including `exports-parity.test.node.ts`. Typecheck will FAIL in `packages/db-postgres` (`createAdminStore` missing `adminPreferences`) — that is the next task's work; confirm it is the ONLY failure before proceeding.

- [ ] **Step 1.9: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): added an admin-preferences module (scoped per-user key-value store)"
```

---

### Task 2: Postgres table, repository, and migrations

**Files:**
- Modify: `packages/db-postgres/src/database/schema/auth.ts`
- Create: `packages/db-postgres/src/modules/admin/admin-preferences-repository.ts`
- Modify: `packages/db-postgres/src/modules/admin/admin-store.ts`
- Modify: `packages/db-postgres/src/modules/admin/index.ts` (mirror however the other `create*Repository` factories are exported there; if only `createAdminStore` is exported, no change is needed)
- Create: `packages/db-postgres/src/modules/admin/tests/admin-preferences.test.ts`
- Create: `packages/db-postgres/sql/0005_add-admin-user-preferences.sql`
- Generated: a new Drizzle migration under `packages/db-postgres/src/database/migrations/` (via `pnpm drizzle:generate`)

**Interfaces:**
- Consumes: `AdminPreferencesRepository`, `AdminUserPreferenceRow` from `@byline/admin/admin-preferences`; `adminUsers`, `timestamps` from the local schema.
- Produces: `createAdminPreferencesRepository(db)`; `adminUserPreferences` Drizzle table; `createAdminStore` now returns the five-repository bundle.

- [ ] **Step 2.1: Add the Drizzle table**

In `packages/db-postgres/src/database/schema/auth.ts`, extend the `drizzle-orm/pg-core` import with `jsonb` and `primaryKey` (keep the existing names), then add after the `adminUsers` table:

```ts
// ---------------------------------------------------------------------------
// byline_admin_user_preferences
// ---------------------------------------------------------------------------

/**
 * Scoped per-user key-value preferences (e.g. sticky list-view page
 * size and sort). One row per (user, scope); `scope` is a dot-separated
 * key like `collections.docs.list` and `value` is a JSONB object whose
 * shape belongs to the scope's feature. Composite natural PK — writes
 * are `INSERT … ON CONFLICT DO UPDATE` with a per-key JSONB merge.
 * See `@byline/admin/admin-preferences`.
 */
export const adminUserPreferences = pgTable(
  'byline_admin_user_preferences',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 255 }).notNull(),
    value: jsonb('value').notNull().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.user_id, table.scope] })]
)
```

- [ ] **Step 2.2: Generate and apply the Drizzle migration**

```bash
pnpm drizzle:generate
pnpm drizzle:migrate
```

Expected: a new numbered migration appears in `packages/db-postgres/src/database/migrations/` containing `CREATE TABLE "byline_admin_user_preferences"`, and migrate applies it to the running dev database without error.

- [ ] **Step 2.3: Write the hand-written SQL migration for existing sites**

Create `packages/db-postgres/sql/0005_add-admin-user-preferences.sql`. Base the DDL on the SQL Drizzle just generated (so constraint names match exactly), wrapped in the guard style of `0001`–`0004`:

```sql
-- =============================================================================
-- Byline: per-user admin preferences  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds `byline_admin_user_preferences` — a scoped per-user key-value store
-- (sticky list-view page size / sort, and future admin-surface preferences).
-- Drizzle-independent equivalent of the schema delta in
-- packages/db-postgres/src/database/schema/auth.ts, for an existing
-- production database that does not run `drizzle:migrate`.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0005_add-admin-user-preferences.sql
--
-- Idempotent: guarded on the table's absence. Runs in one transaction.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "byline_admin_user_preferences" (
  "user_id" uuid NOT NULL,
  "scope" varchar(255) NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "byline_admin_user_preferences_user_id_scope_pk"
    PRIMARY KEY ("user_id", "scope")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'byline_admin_user_preferences'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE "byline_admin_user_preferences"
      ADD CONSTRAINT "byline_admin_user_preferences_user_id_byline_admin_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "byline_admin_users"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
```

**Important:** after `pnpm drizzle:generate`, diff this file's column definitions and constraint names against the generated migration SQL and correct any drift (Drizzle's generated names are authoritative).

- [ ] **Step 2.4: Write the failing repository integration test**

`packages/db-postgres/src/modules/admin/tests/admin-preferences.test.ts` — follow the track-and-clean fixture pattern documented at the top of the sibling `auth-integration.test.ts` (integration tests may share a DB with a running webapp; never blanket-delete):

```ts
import { randomUUID } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { adminUserPreferences, adminUsers } from '../../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAdminPreferencesRepository } from '../admin-preferences-repository.js'
import type { AdminPreferencesRepository } from '@byline/admin/admin-preferences'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../../../database/schema/index.js'

const SCOPE = 'collections.docs.list'

describe('admin-preferences repository (integration)', () => {
  let db: NodePgDatabase<typeof schema>
  let repo: AdminPreferencesRepository
  const createdUserIds = new Set<string>()

  async function createUser(): Promise<string> {
    const id = randomUUID()
    await db.insert(adminUsers).values({
      id,
      email: `pref-test-${id}@example.test`,
      password: '$argon2id$test-not-a-real-hash',
      is_enabled: true,
    })
    createdUserIds.add(id)
    return id
  }

  beforeAll(async () => {
    db = await setupTestDB()
    repo = createAdminPreferencesRepository(db)
  })

  afterEach(async () => {
    if (createdUserIds.size > 0) {
      await db.delete(adminUsers).where(inArray(adminUsers.id, [...createdUserIds]))
      createdUserIds.clear()
    }
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  it('returns null for a missing (user, scope) row', async () => {
    const userId = await createUser()
    expect(await repo.get(userId, SCOPE)).toBeNull()
  })

  it('inserts on first upsert and reads the value back', async () => {
    const userId = await createUser()
    const row = await repo.upsert(userId, SCOPE, { page_size: 50 })
    expect(row.user_id).toBe(userId)
    expect(row.scope).toBe(SCOPE)
    expect(row.value).toEqual({ page_size: 50 })

    const read = await repo.get(userId, SCOPE)
    expect(read?.value).toEqual({ page_size: 50 })
  })

  it('merges per key on conflict — page_size write preserves a stored sort', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { order: 'title', desc: true })
    const merged = await repo.upsert(userId, SCOPE, { page_size: 30 })
    expect(merged.value).toEqual({ order: 'title', desc: true, page_size: 30 })
  })

  it('overwrites the same key on conflict (last writer wins per key)', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { page_size: 15 })
    const updated = await repo.upsert(userId, SCOPE, { page_size: 100 })
    expect(updated.value).toEqual({ page_size: 100 })
  })

  it('keeps scopes independent for the same user', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { page_size: 50 })
    await repo.upsert(userId, 'collections.media.list', { page_size: 15 })
    expect((await repo.get(userId, SCOPE))?.value).toEqual({ page_size: 50 })
    expect((await repo.get(userId, 'collections.media.list'))?.value).toEqual({ page_size: 15 })
  })

  it('cascade-deletes preference rows with the user', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { page_size: 50 })
    await db.delete(adminUsers).where(eq(adminUsers.id, userId))
    createdUserIds.delete(userId)
    const orphans = await db
      .select()
      .from(adminUserPreferences)
      .where(eq(adminUserPreferences.user_id, userId))
    expect(orphans).toHaveLength(0)
  })
})
```

Before running, open `packages/db-postgres/src/lib/test-helper.ts` and confirm the `setupTestDB` / `teardownTestDB` signatures used above (return type, argument list) — copy the exact usage from `auth-integration.test.ts` if it differs. Also check the `adminUsers` insert columns against the sibling test's user-creation helper (the `password` column name and any other NOT NULL columns) and mirror it.

- [ ] **Step 2.5: Run the test to verify it fails**

```bash
cd packages/db-postgres && pnpm vitest run --mode=integration src/modules/admin/tests/admin-preferences.test.ts
```

Expected: FAIL — `Cannot find module '../admin-preferences-repository.js'`.

- [ ] **Step 2.6: Implement the repository and wire the store**

`packages/db-postgres/src/modules/admin/admin-preferences-repository.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm'

import { adminUserPreferences } from '../../database/schema/auth.js'
import type {
  AdminPreferencesRepository,
  AdminUserPreferenceRow,
} from '@byline/admin/admin-preferences'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../../database/schema/index.js'

/**
 * Postgres implementation of `AdminPreferencesRepository`. The upsert
 * merges the JSONB patch per key (`value || patch`) so partial writes
 * (a page-size change) never wipe sibling keys (a stored sort).
 */
export function createAdminPreferencesRepository(
  db: NodePgDatabase<typeof schema>
): AdminPreferencesRepository {
  return {
    async get(userId, scope) {
      const [row] = await db
        .select()
        .from(adminUserPreferences)
        .where(and(eq(adminUserPreferences.user_id, userId), eq(adminUserPreferences.scope, scope)))
      return (row as AdminUserPreferenceRow | undefined) ?? null
    },

    async upsert(userId, scope, patch) {
      const [row] = await db
        .insert(adminUserPreferences)
        .values({ user_id: userId, scope, value: patch })
        .onConflictDoUpdate({
          target: [adminUserPreferences.user_id, adminUserPreferences.scope],
          set: {
            value: sql`${adminUserPreferences.value} || ${JSON.stringify(patch)}::jsonb`,
            updated_at: new Date(),
          },
        })
        .returning()
      if (!row) throw new Error('upsertAdminUserPreference: insert returned no row')
      return row as AdminUserPreferenceRow
    },
  }
}
```

In `packages/db-postgres/src/modules/admin/admin-store.ts`, add the import and factory entry (and change "four admin repositories" to "five" in the doc comment):

```ts
import { createAdminPreferencesRepository } from './admin-preferences-repository.js'
```

```ts
export function createAdminStore(db: NodePgDatabase<typeof schema>): AdminStore {
  return {
    adminUsers: createAdminUsersRepository(db),
    adminRoles: createAdminRolesRepository(db),
    adminPermissions: createAdminPermissionsRepository(db),
    refreshTokens: createRefreshTokensRepository(db),
    adminPreferences: createAdminPreferencesRepository(db),
  }
}
```

- [ ] **Step 2.7: Run the tests to verify they pass**

```bash
cd packages/db-postgres && pnpm vitest run --mode=integration src/modules/admin/tests/admin-preferences.test.ts
cd ../.. && pnpm typecheck
```

Expected: all six tests PASS; workspace typecheck is now clean (the Task 1 `AdminStore` failure is resolved).

- [ ] **Step 2.8: Commit**

```bash
git add packages/db-postgres packages/admin
git commit -m "feat(db-postgres): added byline_admin_user_preferences table, repository, and migrations"
```

---

### Task 3: `setListViewPreference` server fn (write path)

**Files:**
- Create: `packages/host-tanstack-start/src/server-fns/collections/set-list-view-preference.ts`
- Modify: `packages/host-tanstack-start/src/server-fns/collections/index.ts`

**Interfaces:**
- Consumes: `setPreferenceCommand` from `@byline/admin/admin-preferences`; `getAdminRequestContext` from `@byline/client/server`; `bylineCore` from `../../integrations/byline-core.js`.
- Produces: `setListViewPreference({ data: { collection, value } })` server fn, exported from the collections server-fns barrel. `value` is `{ page_size?: number; order?: string; desc?: boolean }`.

- [ ] **Step 3.1: Implement the server fn**

`packages/host-tanstack-start/src/server-fns/collections/set-list-view-preference.ts`:

```ts
/**
 * Persist a per-user list-view preference for one collection.
 *
 * Fire-and-forget from the list UI: changing page size or clicking a
 * column sort quietly upserts the sticky keys for
 * `collections.<path>.list`. The client sends only the keys the
 * interaction changed; the repository merges per key, so a page-size
 * change never wipes a stored sort.
 *
 * Self-service: the target user is always the authenticated actor.
 * `setPreferenceCommand` rejects unauthenticated contexts.
 */

import { createServerFn } from '@tanstack/react-start'

import { setPreferenceCommand } from '@byline/admin/admin-preferences'
import { getAdminRequestContext } from '@byline/client/server'

import { bylineCore } from '../../integrations/byline-core.js'

export interface SetListViewPreferenceInput {
  collection: string
  value: {
    page_size?: number
    order?: string
    desc?: boolean
  }
}

export const setListViewPreference = createServerFn({ method: 'POST' })
  .validator((input: SetListViewPreferenceInput) => input)
  .handler(async ({ data }) => {
    const adminStore = bylineCore().adminStore
    if (adminStore == null) {
      // Headless hosts without an admin store have no preference storage —
      // the save is a silent no-op, mirroring set-locale's posture.
      return { ok: true as const }
    }
    const context = await getAdminRequestContext()
    await setPreferenceCommand(
      context,
      { scope: `collections.${data.collection}.list`, value: data.value },
      { store: adminStore }
    )
    return { ok: true as const }
  })
```

Before finalising, open `packages/host-tanstack-start/src/server-fns/i18n/set-locale.ts` and confirm the `bylineCore()` accessor name and import path match what is used there (this file copies its wiring).

- [ ] **Step 3.2: Export from the barrel**

In `packages/host-tanstack-start/src/server-fns/collections/index.ts`, add (matching the file's existing export style):

```ts
export * from './set-list-view-preference.js'
```

- [ ] **Step 3.3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean. (Server fns are not unit-testable outside the TanStack runtime in this repo — none of the sibling fns have unit tests; behaviour is covered by the Task 8 browser verification.)

- [ ] **Step 3.4: Commit**

```bash
git add packages/host-tanstack-start
git commit -m "feat(host-tanstack-start): added the setListViewPreference server fn"
```

---

### Task 4: Read-side precedence resolver + `getCollectionDocuments` integration

**Files:**
- Create: `packages/host-tanstack-start/src/server-fns/collections/list-view-state.ts`
- Create: `packages/host-tanstack-start/src/server-fns/collections/list-view-state.test.node.ts`
- Modify: `packages/host-tanstack-start/src/server-fns/collections/list.ts:79-95` (the `configuredSort` / `defaultSort` / `sortSpec` block) and `list.ts:146-156` (the `meta` echo)

**Interfaces:**
- Consumes: `getPreferenceCommand` from `@byline/admin/admin-preferences`.
- Produces: `resolveListViewState(input): ResolvedListViewState` — pure, DB-free:

```ts
interface ListViewPreferenceValue { page_size?: number; order?: string; desc?: boolean }
interface ResolveListViewStateInput {
  params: { page_size?: number; order?: string; desc?: boolean }
  preference: ListViewPreferenceValue | null
  orderable: boolean
  sortableFields: string[]
  configuredSort?: { order: string; desc: boolean }
}
interface ResolvedListViewState {
  pageSize: number
  sort?: Record<string, 'asc' | 'desc'>
  metaOrder?: string
  metaDesc?: boolean
}
```

- [ ] **Step 4.1: Write the failing resolver tests**

`packages/host-tanstack-start/src/server-fns/collections/list-view-state.test.node.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveListViewState } from './list-view-state.js'

const base = {
  params: {},
  preference: null,
  orderable: false,
  sortableFields: ['title', 'summary', 'created_at', 'updated_at'],
  configuredSort: undefined,
}

describe('resolveListViewState', () => {
  it('defaults to page size 20 and no sort when nothing is set', () => {
    expect(resolveListViewState({ ...base })).toEqual({ pageSize: 20 })
  })

  it('lets explicit URL params win over preference and configured sort', () => {
    const result = resolveListViewState({
      ...base,
      params: { page_size: 15, order: 'title', desc: false },
      preference: { page_size: 100, order: 'summary', desc: true },
      configuredSort: { order: 'created_at', desc: true },
    })
    expect(result).toEqual({
      pageSize: 15,
      sort: { title: 'asc' },
      metaOrder: 'title',
      metaDesc: false,
    })
  })

  it('preserves the pre-existing "omitted desc means descending" param semantics', () => {
    const result = resolveListViewState({ ...base, params: { order: 'title' } })
    expect(result.sort).toEqual({ title: 'desc' })
    // meta passthrough stays exactly what the URL carried (undefined here).
    expect(result.metaOrder).toBe('title')
    expect(result.metaDesc).toBeUndefined()
  })

  it('applies the preference on a params-less landing', () => {
    const result = resolveListViewState({
      ...base,
      preference: { page_size: 50, order: 'title', desc: true },
    })
    expect(result).toEqual({
      pageSize: 50,
      sort: { title: 'desc' },
      metaOrder: 'title',
      metaDesc: true,
    })
  })

  it('skips a stale preference order and falls through to configuredSort', () => {
    const result = resolveListViewState({
      ...base,
      preference: { order: 'removed_field', desc: true },
      configuredSort: { order: 'created_at', desc: true },
    })
    expect(result.sort).toEqual({ created_at: 'desc' })
    expect(result.metaOrder).toBe('created_at')
  })

  it('ignores an out-of-range or non-integer preference page_size', () => {
    expect(resolveListViewState({ ...base, preference: { page_size: 0 } }).pageSize).toBe(20)
    expect(resolveListViewState({ ...base, preference: { page_size: 999 } }).pageSize).toBe(20)
    expect(resolveListViewState({ ...base, preference: { page_size: 12.5 } }).pageSize).toBe(20)
  })

  it('applies page_size but never sort preferences on orderable collections', () => {
    const result = resolveListViewState({
      ...base,
      orderable: true,
      preference: { page_size: 50, order: 'title', desc: true },
    })
    expect(result).toEqual({ pageSize: 50, sort: { order_key: 'asc' } })
  })

  it('still lets explicit params override the drag order on orderable collections', () => {
    const result = resolveListViewState({
      ...base,
      orderable: true,
      params: { order: 'title', desc: true },
    })
    expect(result.sort).toEqual({ title: 'desc' })
  })

  it('combines a page_size-only preference with configuredSort', () => {
    const result = resolveListViewState({
      ...base,
      preference: { page_size: 30 },
      configuredSort: { order: 'created_at', desc: true },
    })
    expect(result).toEqual({
      pageSize: 30,
      sort: { created_at: 'desc' },
      metaOrder: 'created_at',
      metaDesc: true,
    })
  })
})
```

- [ ] **Step 4.2: Run the test to verify it fails**

```bash
cd packages/host-tanstack-start && pnpm vitest run --mode=node src/server-fns/collections/list-view-state.test.node.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement the resolver**

`packages/host-tanstack-start/src/server-fns/collections/list-view-state.ts`:

```ts
/**
 * Pure precedence resolver for the collection list view's page size and
 * sort — extracted from the list server fn so the chain is testable
 * without a database:
 *
 *   URL params → user preference → configured defaultSort → storage
 *   default (created_at desc, expressed as "no sort spec")
 *
 * `orderable: true` collections sort by the drag order (`order_key asc`)
 * and never take sort preferences or a configured default — but explicit
 * URL params still win (a shared sorted link opens as sent), and a
 * page-size preference still applies.
 *
 * A preference `order` naming a field that is no longer sortable on the
 * collection is skipped (not an error): the schema may have moved on
 * since the preference was written.
 */

export interface ListViewPreferenceValue {
  page_size?: number
  order?: string
  desc?: boolean
}

export interface ResolveListViewStateInput {
  params: { page_size?: number; order?: string; desc?: boolean }
  preference: ListViewPreferenceValue | null
  orderable: boolean
  /** Field names valid as a sort column (collection fields + system columns). */
  sortableFields: string[]
  configuredSort?: { order: string; desc: boolean }
}

export interface ResolvedListViewState {
  pageSize: number
  /** Sort spec for `CollectionHandle.find`; undefined → storage default. */
  sort?: Record<string, 'asc' | 'desc'>
  /** Effective sort echoed through `meta.order` / `meta.desc` for the header indicator. */
  metaOrder?: string
  metaDesc?: boolean
}

export function resolveListViewState(input: ResolveListViewStateInput): ResolvedListViewState {
  const { params, preference, orderable, sortableFields, configuredSort } = input

  // Defensive clamp at read time — the write path validates 1–100, but a
  // hand-edited row must degrade to the default, not a absurd page.
  const rawPrefPageSize = preference?.page_size
  const prefPageSize =
    typeof rawPrefPageSize === 'number' &&
    Number.isInteger(rawPrefPageSize) &&
    rawPrefPageSize >= 1 &&
    rawPrefPageSize <= 100
      ? rawPrefPageSize
      : undefined
  const pageSize = params.page_size ?? prefPageSize ?? 20

  // Explicit URL params always win. Semantics preserved from the original
  // inline code: an omitted `desc` alongside an explicit `order` sorts
  // descending, and the meta echo passes the raw param values through.
  if (params.order) {
    return {
      pageSize,
      sort: { [params.order]: params.desc === false ? 'asc' : 'desc' },
      metaOrder: params.order,
      metaDesc: params.desc,
    }
  }

  if (orderable) {
    return { pageSize, sort: { order_key: 'asc' } }
  }

  const rawPrefOrder = preference?.order
  const prefOrder =
    typeof rawPrefOrder === 'string' && sortableFields.includes(rawPrefOrder)
      ? rawPrefOrder
      : undefined
  if (prefOrder != null) {
    const desc = preference?.desc === true
    return {
      pageSize,
      sort: { [prefOrder]: desc ? 'desc' : 'asc' },
      metaOrder: prefOrder,
      metaDesc: desc,
    }
  }

  if (configuredSort != null) {
    return {
      pageSize,
      sort: { [configuredSort.order]: configuredSort.desc ? 'desc' : 'asc' },
      metaOrder: configuredSort.order,
      metaDesc: configuredSort.desc,
    }
  }

  return { pageSize }
}
```

- [ ] **Step 4.4: Run the test to verify it passes**

```bash
cd packages/host-tanstack-start && pnpm vitest run --mode=node src/server-fns/collections/list-view-state.test.node.ts
```

Expected: PASS (9 tests).

- [ ] **Step 4.5: Integrate into the list server fn**

In `packages/host-tanstack-start/src/server-fns/collections/list.ts`:

Add imports:

```ts
import { getPreferenceCommand } from '@byline/admin/admin-preferences'
import { getAdminRequestContext } from '@byline/client/server'

import { bylineCore } from '../../integrations/byline-core.js'
import { resolveListViewState } from './list-view-state.js'
import type { ListViewPreferenceValue } from './list-view-state.js'
```

Replace the block from `const pageSize = params.page_size ?? 20` (line 60) plus the whole `configuredSort` / `defaultSort` / `sortSpec` section (lines 79–95) with:

```ts
    // Sort/page-size precedence (see list-view-state.ts): the caller's
    // explicit params always win (a shared link opens exactly as sent) →
    // the actor's stored per-collection preference → the admin config's
    // `defaultSort` → the storage fallback (`created_at desc`). The
    // effective sort is echoed through `meta.order`/`meta.desc` below so
    // the list header renders the right indicator on a params-less landing.
    const adminConfig = getCollectionAdminConfig(path)
    const configuredSort =
      config.definition.orderable !== true && adminConfig?.defaultSort != null
        ? {
            order: String(adminConfig.defaultSort.field),
            desc: adminConfig.defaultSort.direction === 'desc',
          }
        : undefined

    // Per-user preference — read only when it could matter (some param
    // absent). Failures (headless context, unauthenticated preview, DB
    // hiccup) log and fall through: preferences can never break the list.
    let preference: ListViewPreferenceValue | null = null
    const adminStore = bylineCore().adminStore
    if (adminStore != null && (params.page_size == null || params.order == null)) {
      try {
        const context = await getAdminRequestContext()
        const res = await getPreferenceCommand(
          context,
          { scope: `collections.${path}.list` },
          { store: adminStore }
        )
        preference = (res.value as ListViewPreferenceValue | null) ?? null
      } catch (err) {
        getLogger().warn(
          { err, collection: path },
          'list-view preference read failed — using defaults'
        )
      }
    }

    const viewState = resolveListViewState({
      params: { page_size: params.page_size, order: params.order, desc: params.desc },
      preference,
      orderable: config.definition.orderable === true,
      sortableFields: [
        ...config.definition.fields.map((f) => f.name),
        'created_at',
        'updated_at',
      ],
      configuredSort,
    })
    const pageSize = viewState.pageSize
```

Note the original `const adminConfig = getCollectionAdminConfig(path)` at line 79 is subsumed by this block — do not declare it twice. Then:

- In the `handle.find({ … })` call, change `sort: sortSpec` to `sort: viewState.sort` (`pageSize` is already threaded).
- In the `meta` echo, replace

```ts
        order: params.order ?? configuredSort?.order,
        desc: params.desc ?? configuredSort?.desc,
```

with

```ts
        order: viewState.metaOrder,
        desc: viewState.metaDesc,
        pageSize,
```

(`pageSize` was already present in `result.meta` from the client; restating it here is explicit and keeps the effective value authoritative after preference application.)

Check `getLogger()` returns a pino-style logger where `.warn(obj, msg)` is valid — it is used exactly that way if you grep `getLogger().warn` in `packages/core`; if the signature differs, match the codebase's call shape.

- [ ] **Step 4.6: Typecheck and run the package tests**

```bash
pnpm typecheck
cd packages/host-tanstack-start && pnpm test
```

Expected: both clean.

- [ ] **Step 4.7: Commit**

```bash
git add packages/host-tanstack-start
git commit -m "feat(host-tanstack-start): applied per-user list-view preferences in the list server fn"
```

---

### Task 5: Client write triggers + effective page-size display

**Files:**
- Modify: `packages/host-tanstack-start/src/admin-shell/chrome/th-sortable.tsx`
- Modify: `packages/host-tanstack-start/src/admin-shell/collections/list.tsx`

**Interfaces:**
- Consumes: `setListViewPreference` from `../../server-fns/collections/index.js` (Task 3).
- Produces: `TableHeadingCellSortable` gains an optional `onSort?: (order: string, desc: boolean) => void` prop (backwards-compatible — the admin-users list continues to omit it).

- [ ] **Step 5.1: Add the `onSort` callback to the sortable header cell**

In `packages/host-tanstack-start/src/admin-shell/chrome/th-sortable.tsx`:

Add to `TableHeadingCellSortableProps`:

```ts
  /**
   * Fired after a sort click navigates, with the new order/direction.
   * The collection list uses this to persist the choice as a sticky
   * per-user preference; surfaces that omit it (admin-users) are
   * unaffected.
   */
  onSort?: (order: string, desc: boolean) => void
```

Destructure `onSort` in the component parameters, and in `handleOnSort` add the callback after `navigate(…)`:

```ts
  const handleOnSort = (descending: boolean) => (): void => {
    if (fieldName != null) {
      const params = structuredClone(location.search)
      delete params.page
      params.order = fieldName
      params.desc = descending
      setDesc(descending)
      navigate({
        to: location.pathname as never,
        search: params,
      })
      onSort?.(fieldName, descending)
    }
  }
```

- [ ] **Step 5.2: Wire persistence into the list view**

In `packages/host-tanstack-start/src/admin-shell/collections/list.tsx`:

Add the import (grouped with the other local imports; check how sibling admin-shell files like `reindex-button.tsx` import server fns and match the path style):

```ts
import { setListViewPreference } from '../../server-fns/collections/index.js'
```

Add the fire-and-forget helper inside the `ListView` component body (near the other handlers, after `handleOnPageSizeChange`):

```ts
  // Quietly persist sticky view keys as a per-user preference. Fire-and-
  // forget: the navigation already happened, so a failed save must never
  // toast, block, or roll anything back.
  const persistListPreference = (value: {
    page_size?: number
    order?: string
    desc?: boolean
  }): void => {
    setListViewPreference({
      data: { collection: data.included.collection.path as string, value },
    }).catch((err: unknown) => {
      console.warn('list-view preference save failed:', err)
    })
  }
```

In `handleOnPageSizeChange`, persist after the navigate:

```ts
  function handleOnPageSizeChange(value: string | null): void {
    if (typeof value !== 'string' || value.length === 0) return
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = Number.parseInt(value, 10)
    navigate({
      to: getAdminRoutePath('collections', '$collection'),
      params: { collection: data.included.collection.path },
      search: params,
    })
    persistListPreference({ page_size: Number.parseInt(value, 10) })
  }
```

On the **non-orderable** table's `TableHeadingCellSortable` (the second usage, around line 502 — inside the plain `<Table.Header>` branch), add:

```tsx
  onSort={(order, desc) => persistListPreference({ order, desc })}
```

Deliberately do NOT add `onSort` to the orderable/drag branch's heading cells (~line 422) — the read side skips sort preferences for orderable collections, so persisting there would write dead data.

- [ ] **Step 5.3: Make the page-size select show the effective value**

Still in `list.tsx`: the page-size `<Select>` (search for `id="page_size"`) currently hardcodes `defaultValue="15"`, so a preferred page size on a params-less landing displays wrongly. Make it controlled by the effective value. First extend the `searchParams` cast (around line 201) with `page_size?: number`:

```ts
  const searchParams = location.search as {
    page_size?: number
    order?: string
    desc?: boolean
    query?: string
    status?: string
  }
```

Then replace `defaultValue="15"` on the Select with:

```tsx
  value={String(searchParams.page_size ?? data?.meta.pageSize ?? 15)}
```

(`meta.pageSize` is the server's effective page size after preference application — Task 4 restates it.) Keep the memoization caution from the `statusItems` comment in mind: the `items` array for this Select is a static inline literal of four objects; if switching to a controlled `value` provokes the Base UI identity loop described there, hoist the items array into a `useMemo` the same way `statusItems` is.

- [ ] **Step 5.4: Typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean (lint may auto-fix formatting — re-stage if so).

- [ ] **Step 5.5: Commit**

```bash
git add packages/host-tanstack-start
git commit -m "feat(host-tanstack-start): persisted page-size and sort choices as per-user list preferences"
```

---

### Task 6: Return-state helpers (`from` param encode/decode)

**Files:**
- Create: `packages/host-tanstack-start/src/routes/list-return-state.ts`
- Create: `packages/host-tanstack-start/src/routes/list-return-state.test.node.ts`
- Modify: `packages/host-tanstack-start/src/routes/create-collection-list-route.tsx:36-45` (replace the local `searchSchema` with an import)

**Interfaces:**
- Produces:
  - `collectionListSearchSchema` (the list route's Zod search schema, relocated here)
  - `encodeListReturnState(search: Record<string, unknown>): string | undefined`
  - `decodeListReturnState(from: string | undefined): Record<string, unknown> | undefined`

- [ ] **Step 6.1: Write the failing helper tests**

`packages/host-tanstack-start/src/routes/list-return-state.test.node.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { decodeListReturnState, encodeListReturnState } from './list-return-state.js'

describe('encodeListReturnState / decodeListReturnState', () => {
  it('round-trips a full list search state', () => {
    const search = {
      page: 7,
      page_size: 50,
      order: 'title',
      desc: false,
      query: 'harvest',
      locale: 'fr',
      status: 'draft',
    }
    const encoded = encodeListReturnState(search)
    expect(typeof encoded).toBe('string')
    expect(decodeListReturnState(encoded)).toEqual(search)
  })

  it('returns undefined for an empty search (no point carrying a bare target)', () => {
    expect(encodeListReturnState({})).toBeUndefined()
  })

  it('never carries the transient action param', () => {
    const encoded = encodeListReturnState({ page: 2, action: 'created' })
    expect(decodeListReturnState(encoded)).toEqual({ page: 2 })
  })

  it('decodes desc=false as boolean false (not string-coerced truthiness)', () => {
    const decoded = decodeListReturnState('order=title&desc=false')
    expect(decoded).toEqual({ order: 'title', desc: false })
  })

  it('degrades malformed input to undefined instead of throwing', () => {
    expect(decodeListReturnState(undefined)).toBeUndefined()
    expect(decodeListReturnState('')).toBeUndefined()
    expect(decodeListReturnState('page=notanumber')).toBeUndefined()
    expect(decodeListReturnState('page=0')).toBeUndefined()
    expect(decodeListReturnState('page_size=99999')).toBeUndefined()
  })

  it('drops empty-string values at encode time', () => {
    const encoded = encodeListReturnState({ page: 3, query: '' })
    expect(decodeListReturnState(encoded)).toEqual({ page: 3 })
  })
})
```

- [ ] **Step 6.2: Run the test to verify it fails**

```bash
cd packages/host-tanstack-start && pnpm vitest run --mode=node src/routes/list-return-state.test.node.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement the helpers**

`packages/host-tanstack-start/src/routes/list-return-state.ts`:

```ts
/**
 * Return-to-list state for the collection editor (issue #17).
 *
 * The list route holds its complete view state in URL search params, so
 * "come back to page 7 of the filtered list" needs no storage: the list
 * encodes its current search into a single `from` param on the editor
 * link, the editor threads it through its own navigations, and
 * close/delete decode it back into list search params. Malformed or
 * absent state degrades to the bare list — never an error.
 *
 * The list route's search schema lives here (rather than in the route
 * factory) so the helpers and the factory share one definition without
 * a circular import.
 */

import { z } from 'zod'

export const collectionListSearchSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().max(100).optional(),
  order: z.string().optional(),
  desc: z.coerce.boolean().optional(),
  query: z.string().optional(),
  locale: z.string().optional(),
  status: z.string().optional(),
  action: z.enum(['created']).optional(),
})

export type CollectionListSearch = z.infer<typeof collectionListSearchSchema>

/**
 * The keys a return target carries. `action` is transient (post-create
 * toast trigger) and must never round-trip through a return target.
 */
const RETURN_KEYS = ['page', 'page_size', 'order', 'desc', 'query', 'locale', 'status'] as const

/** `undefined` when there is nothing worth carrying (bare list). */
export function encodeListReturnState(search: Record<string, unknown>): string | undefined {
  const params = new URLSearchParams()
  for (const key of RETURN_KEYS) {
    const value = search[key]
    if (value != null && value !== '') params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded.length > 0 ? encoded : undefined
}

/**
 * Parse a `from` param back into list search params. Runs the decoded
 * pairs through the list search schema; anything malformed returns
 * `undefined` (→ bare list). `desc` needs explicit normalisation
 * because `z.coerce.boolean()` would coerce the string `'false'` to
 * `true`.
 */
export function decodeListReturnState(
  from: string | undefined
): Record<string, unknown> | undefined {
  if (from == null || from.length === 0) return undefined
  const raw: Record<string, unknown> = Object.fromEntries(new URLSearchParams(from))
  delete raw.action
  if (typeof raw.desc === 'string') raw.desc = raw.desc === 'true'
  const parsed = collectionListSearchSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}
```

Note: the schema is copied verbatim from `create-collection-list-route.tsx` — including its existing looseness (`page_size` has `max(100)` but no `min`). Do not tighten it here; parity with the route is the contract. The malformed-input test cases rely on that schema: `page=0` fails `min(1)` and `page_size=99999` fails `max(100)`, so `safeParse` fails and the decoder returns `undefined`.

- [ ] **Step 6.4: Run the test to verify it passes**

```bash
cd packages/host-tanstack-start && pnpm vitest run --mode=node src/routes/list-return-state.test.node.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6.5: Point the list route factory at the shared schema**

In `packages/host-tanstack-start/src/routes/create-collection-list-route.tsx`: delete the local `const searchSchema = z.object({ … })` (lines 36–45) and the now-unused `z` import if nothing else uses it, and add:

```ts
import { collectionListSearchSchema as searchSchema } from './list-return-state.js'
```

Everything else in the file (`z.infer<typeof searchSchema>` references) keeps working unchanged.

- [ ] **Step 6.6: Typecheck and run package tests**

```bash
pnpm typecheck
cd packages/host-tanstack-start && pnpm test
```

Expected: clean.

- [ ] **Step 6.7: Commit**

```bash
git add packages/host-tanstack-start
git commit -m "feat(host-tanstack-start): added list return-state helpers and shared the list search schema"
```

---

### Task 7: Thread `from` through list → editor → back

**Files:**
- Modify: `packages/host-tanstack-start/src/admin-shell/collections/list.tsx` (three `Link`s: two edit links ~lines 457 and 533, the create button ~line 339)
- Modify: `packages/host-tanstack-start/src/routes/create-collection-edit-route.tsx` (search schema + decode + prop)
- Modify: `packages/host-tanstack-start/src/admin-shell/collections/edit.tsx` (new prop; consume on cancel/delete; stop dropping search on locale navigations; thread through duplicate)
- Modify: `packages/host-tanstack-start/src/routes/create-collection-create-route.tsx` (add `validateSearch` + prop)
- Modify: `packages/host-tanstack-start/src/admin-shell/collections/create.tsx` (consume on cancel; thread into the create → edit redirect)

**Interfaces:**
- Consumes: `encodeListReturnState` / `decodeListReturnState` from `../../routes/list-return-state.js` (Task 6).
- Produces: `EditView` gains `returnSearch?: Record<string, unknown>`; `CreateView` gains `from?: string`; edit route search schema gains `from: z.string().optional()`.

- [ ] **Step 7.1: Carry `from` on the list's outbound links**

In `list.tsx`, add the import:

```ts
import { encodeListReturnState } from '../../routes/list-return-state.js'
```

Both edit `Link`s (the orderable branch ~line 457 and the standard branch ~line 533) get a `search` prop:

```tsx
  <Link
    to={getAdminRoutePath('collections', '$collection', '$id')}
    params={{
      collection: data.included.collection.path,
      id: document.id,
    }}
    search={{ from: encodeListReturnState(location.search as Record<string, unknown>) }}
  >
```

The create `IconButton`'s `Link` (~line 339) gets the same `search={{ from: encodeListReturnState(location.search as Record<string, unknown>) }}`.

(`encodeListReturnState` returns `undefined` for a bare list, so a params-less list produces clean editor URLs with no `from` at all.)

- [ ] **Step 7.2: Accept and decode `from` in the edit route**

In `create-collection-edit-route.tsx`, extend the search schema:

```ts
const searchSchema = z.object({
  locale: z.string().optional(),
  /** Set by the create view's create → edit redirect; fires the created toast. */
  action: z.enum(['created']).optional(),
  /** URL-encoded list search state to return to on close — see list-return-state.ts. */
  from: z.string().optional(),
})
```

Add the import and pass the decoded state to `EditView` in the component:

```ts
import { decodeListReturnState } from './list-return-state.js'
```

```tsx
  <EditView
    collectionDefinition={collectionDef}
    adminConfig={adminConfig ?? undefined}
    initialData={data}
    locale={locale}
    contentLocales={contentLocales}
    defaultContentLocale={defaultContentLocale}
    returnSearch={decodeListReturnState(search.from)}
  />
```

- [ ] **Step 7.3: Consume `returnSearch` in the edit view and stop dropping search state**

In `edit.tsx`:

1. Add `returnSearch?: Record<string, unknown>` to the `EditView` props type and destructuring (find the component's parameter list — the props include `collectionDefinition`, `adminConfig`, `initialData`, `locale`, `contentLocales`, `defaultContentLocale`).

2. `onCancel` (line ~532) — navigate to the return target:

```tsx
  onCancel={() =>
    navigate({
      to: getAdminRoutePath('collections', '$collection'),
      params: { collection: path },
      search: returnSearch,
    })
  }
```

3. `handleDelete`'s post-delete navigation (line ~371) — same treatment:

```ts
      navigate({
        to: getAdminRoutePath('collections', '$collection'),
        params: { collection: path },
        search: returnSearch,
      })
```

4. Fix the three navigations that currently REPLACE the whole search record (dropping `from` — and today already dropping any other search state). Each becomes a spread-prev updater:

`handleLocaleChange` (line ~77):

```ts
    navigate({
      to: getAdminRoutePath('collections', '$collection', '$id'),
      params: { collection: path, id: String(initialData.id) },
      search: (prev: Record<string, unknown>) => ({ ...prev, locale: newLocale }),
    })
```

`handleCopyToLocale`'s post-copy navigation (line ~274):

```ts
      navigate({
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev, locale: targetLocale }),
      })
```

`handleDeleteLocale`'s navigation (line ~326):

```ts
      navigate({
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: String(initialData.id) },
        search: (prev: Record<string, unknown>) => ({ ...prev, locale: defaultContentLocale }),
      })
```

5. `handleDuplicate`'s navigation to the new document (line ~200) — thread the search (including `from`) forward so closing the duplicate returns to the originating list:

```ts
      navigate({
        to: getAdminRoutePath('collections', '$collection', '$id'),
        params: { collection: path, id: result.documentId },
        search: (prev: Record<string, unknown>) => ({ ...prev }),
      })
```

(The `handleSubmit` and `handleStatusChange` / `handleUnpublish` re-navigations already spread `prev`, so `from` survives saves with no change.)

- [ ] **Step 7.4: Same treatment for the create flow**

In `create-collection-create-route.tsx` — the route currently has no `validateSearch`. Add one, plus the prop:

```ts
import { z } from 'zod'
```

```ts
const searchSchema = z.object({
  /** URL-encoded list search state to return to on cancel — see list-return-state.ts. */
  from: z.string().optional(),
})
```

Add `validateSearch: searchSchema,` to the `createFileRoute` options (before `loader`), and in the component:

```ts
      const search = Route.useSearch() as z.infer<typeof searchSchema>
```

then pass `from={search.from}` to `<CreateView … />`.

In `create.tsx`:

1. Add `from?: string` to the `CreateView` props type and destructuring.
2. Add the import:

```ts
import { decodeListReturnState } from '../../routes/list-return-state.js'
```

3. `onCancel` (line ~119):

```tsx
  onCancel={() =>
    navigate({
      to: getAdminRoutePath('collections', '$collection'),
      params: { collection: path },
      search: decodeListReturnState(from),
    })
  }
```

4. The create → edit redirect (line ~69) threads `from` so closing the brand-new document also returns to the originating list; the list-fallback branch (line ~75) restores the state directly:

```ts
      if (result?.documentId) {
        navigate({
          to: getAdminRoutePath('collections', '$collection', '$id'),
          params: { collection: path, id: result.documentId } as never,
          search: { action: 'created', from },
        })
      } else {
        navigate({
          to: getAdminRoutePath('collections', '$collection'),
          params: { collection: path },
          search: { ...decodeListReturnState(from), action: 'created' },
        })
      }
```

- [ ] **Step 7.5: Typecheck, lint, package tests**

```bash
pnpm typecheck && pnpm lint
cd packages/host-tanstack-start && pnpm test
```

Expected: clean.

- [ ] **Step 7.6: Commit**

```bash
git add packages/host-tanstack-start
git commit -m "feat(host-tanstack-start): editor returns to the originating list page and filters on close"
```

---

### Task 8: Full-suite verification + browser proof

**Files:** none (verification only; fix-forward anything found, amending the relevant task's commit style)

- [ ] **Step 8.1: Full static + unit pass**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green.

- [ ] **Step 8.2: Integration suite**

```bash
pnpm test:integration
```

Expected: all green (requires `byline_test`; run `pnpm db:init:test` once if missing).

- [ ] **Step 8.3: Browser verification (dev server)**

Start the dev server via the Browser pane's preview tooling (never Bash): `preview_start` with the launch config for the webapp (Vite on `:5173`), sign in to the admin, then verify each spec scenario:

1. **Preference write + params-less landing:** On the docs collection list, change page size to 50 and click a column sort. Navigate away (dashboard), then click the docs admin-menu link (params-less URL). Expected: list renders 50 rows/page with the chosen sort, sort indicator correct, page-size select shows 50, no visible re-sort flicker, no console errors.
2. **URL params still win:** Open the same list with explicit `?page_size=15&order=<other-field>` — the explicit params render, preference untouched.
3. **Merge semantics:** Change only page size again; confirm the sort preference still applies on the next params-less landing.
4. **Return-to-list:** Filter the list (status filter + a search query), go to page 2, open a document. Save it. Close it (cancel/back button). Expected: land on page 2 with the filter and query intact.
5. **Locale-switch survival:** Repeat 4 but switch the editor's content locale before closing. Expected: return target still intact.
6. **Delete path:** Open a (disposable) document from a filtered page, delete it. Expected: land back on the filtered list.
7. **Create path:** From a filtered list, open create, cancel. Expected: back to the filtered list.
8. **Bare-list degradation:** Open an editor URL directly with no `from` (and with a garbage `from=%%%`). Expected: close lands on the bare list; no errors.

Capture a screenshot of scenario 1's landing and scenario 4's return as proof for the PR. Check `read_console_messages` and `preview_logs` for errors after each scenario.

- [ ] **Step 8.4: Verify SQL script on a scratch schema (cheap sanity)**

```bash
psql "$DATABASE_URL" -c "SELECT 1"  # confirm connectivity — use the dev DB env from packages/db-postgres/.env
```

The dev database already has the table via `drizzle:migrate`, so run the hand-written script against it to prove idempotency:

```bash
psql "$DATABASE_URL" -f packages/db-postgres/sql/0005_add-admin-user-preferences.sql
```

Expected: completes without error (`IF NOT EXISTS` no-ops).

---

### Task 9: Pull request

- [ ] **Step 9.1: Push and open the PR**

Use the repo's `github-pr` / `create-pr` skill (it owns branch naming, issue linking, and description format). The PR:

- Base: `develop`. Head: `feat/list-view-preferences`.
- Title: `feat: per-user list-view preferences and return-to-list state`
- Body must reference `Closes #16` and `Closes #17`, summarise the precedence chain (`URL → preference → defaultSort → created_at desc`), call out the migration in both streams (Drizzle + `packages/db-postgres/sql/0005_add-admin-user-preferences.sql`), link the spec (`specs/2026-07-21-list-view-preferences-and-return-state-design.md`), and include the two browser-proof screenshots.
- Per the repo's commit/PR conventions: no AI-attribution trailers anywhere.

---

## Plan Self-Review (completed at write time)

- **Spec coverage:** table + both migration streams (Task 2), admin module + self-service commands (Task 1), write server fn (Task 3), read-path precedence inside `getCollectionDocuments` with meta echo + stale-order skip + orderable/tree exclusion (Task 4; tree collections never reach the code path — their loader branches to `getCollectionTree` first), implicit client write triggers with silent failure (Task 5), `from` helpers with malformed-input degradation (Task 6), full threading including the three fixed search-dropping navigations, duplicate, and the create flow (Task 7), error handling embedded per task, testing tiers (Tasks 1/2/4/6 + browser in 8), single PR referencing both issues (Task 9). No spec requirement is untasked.
- **Placeholder scan:** no TBDs; every code step shows the code. Steps that depend on possibly-drifted sibling signatures (`createCommand`, `setupTestDB`, `bylineCore`) say exactly which file to copy the current shape from.
- **Type consistency:** `AdminPreferencesRepository.upsert(userId, scope, patch)` (Tasks 1/2), `getPreferenceCommand`/`setPreferenceCommand` `(context, input, { store })` (Tasks 1/3/4), `ListViewPreferenceValue` + `resolveListViewState` (Task 4), `setListViewPreference({ data: { collection, value } })` (Tasks 3/5), `encodeListReturnState`/`decodeListReturnState` + `collectionListSearchSchema` (Tasks 6/7), `returnSearch` (EditView) / `from` (CreateView) (Task 7) — names match across tasks.
