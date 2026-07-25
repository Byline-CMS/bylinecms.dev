/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Auth schema — admin identity, roles, role-user assignment, and per-role
 * ability grants.
 *
 * All tables carry the `byline_` prefix so Byline can coexist with other
 * schemas in a shared database. The TypeScript exports are unprefixed —
 * the prefix is a DB-side concern.
 *
 * Shape mirrors the mature Modulus Learning implementation with minor
 * Byline conventions:
 *   - UUIDv7 primary keys (generated at insert time in the repository).
 *   - `vid` integer version column for optimistic concurrency (defaults
 *     to 1; bumped by write paths when needed).
 *   - snake_case column names matching the rest of the Byline schema.
 *
 * See docs/06-auth-and-security/01-authn-authz.md for the full data model and present-state
 * reference.
 */

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

import { createdAt, timestamps, uuidChar } from './common.js'

// Foreign keys below use the table-level `foreignKey()` builder with an
// explicit, short `fk_<table>_<column>` name rather than the Postgres
// schema's column-level `.references()` shorthand — MySQL enforces a hard
// 64-character identifier cap that several of this schema's auto-generated
// FK names exceed. See the longer explanation in `./index.ts`.

// ---------------------------------------------------------------------------
// byline_admin_users
// ---------------------------------------------------------------------------

export const adminUsers = mysqlTable(
  'byline_admin_users',
  {
    id: uuidChar('id').primaryKey(),
    vid: int('vid').notNull().default(1),
    given_name: varchar('given_name', { length: 100 }),
    family_name: varchar('family_name', { length: 100 }),
    /** Optional — email is the primary identifier. Unique when present. */
    username: varchar('username', { length: 64 }).unique(),
    email: varchar('email', { length: 254 }).notNull().unique(),
    /** Full PHC string, e.g. `$argon2id$v=19$m=…$…$…`. */
    password: varchar('password', { length: 255 }).notNull(),
    remember_me: boolean('remember_me').notNull().default(false),
    last_login: datetime('last_login', { fsp: 3 }),
    last_login_ip: varchar('last_login_ip', { length: 45 }),
    failed_login_attempts: int('failed_login_attempts').notNull().default(0),
    /**
     * Actor-level super-admin bypass. When true, `AdminAuth.isSuperAdmin`
     * short-circuits every ability check. Set only via the seed script
     * (or manually by a DB admin) — never via the admin UI.
     */
    is_super_admin: boolean('is_super_admin').notNull().default(false),
    /**
     * Account enablement. Defaults to `false` so accounts created through
     * any future admin UI require a deliberate enable step. The super-admin
     * seed sets this to `true`.
     */
    is_enabled: boolean('is_enabled').notNull().default(false),
    is_email_verified: boolean('is_email_verified').notNull().default(false),
    /**
     * Per-user admin interface locale preference. Nullable — `null` means
     * "use the detection cascade" (cookie → Accept-Language → defaultLocale).
     * Stored as a BCP 47 code (`en`, `pt-BR`, `zh-Hans-CN`); validated at
     * write time against the host's `i18n.interface.locales` set.
     */
    preferred_locale: varchar('preferred_locale', { length: 16 }),
    ...timestamps,
  },
  (table) => [index('idx_byline_admin_users_email').on(table.email)]
)

// ---------------------------------------------------------------------------
// byline_admin_user_preferences
// ---------------------------------------------------------------------------

/**
 * Scoped per-user key-value preferences (e.g. sticky list-view page
 * size and sort). One row per (user, scope); `scope` is a dot-separated
 * key like `collections.docs.list` and `value` is a JSON object whose
 * shape belongs to the scope's feature. Composite natural PK — writes
 * are `INSERT … ON DUPLICATE KEY UPDATE` with a per-key JSON merge.
 * See `@byline/admin/admin-preferences`.
 */
export const adminUserPreferences = mysqlTable(
  'byline_admin_user_preferences',
  {
    user_id: uuidChar('user_id').notNull(),
    scope: varchar('scope', { length: 255 }).notNull(),
    value: json('value').notNull().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_admin_user_preferences_user_id',
      columns: [table.user_id],
      foreignColumns: [adminUsers.id],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.user_id, table.scope] }),
  ]
)

// ---------------------------------------------------------------------------
// byline_admin_roles
// ---------------------------------------------------------------------------

export const adminRoles = mysqlTable(
  'byline_admin_roles',
  {
    id: uuidChar('id').primaryKey(),
    vid: int('vid').notNull().default(1),
    /** Human-readable label, e.g. `'Editor'`. */
    name: varchar('name', { length: 128 }).notNull(),
    /** Stable identifier used in code, e.g. `'editor'`, `'super-admin'`. */
    machine_name: varchar('machine_name', { length: 128 }).notNull().unique(),
    description: text('description'),
    /** Display ordering in the role-editor UI. */
    order: int('order').notNull().default(0),
    ...timestamps,
  },
  (table) => [index('idx_byline_admin_roles_machine_name').on(table.machine_name)]
)

// ---------------------------------------------------------------------------
// byline_admin_role_admin_user — many-to-many join
// ---------------------------------------------------------------------------

export const adminRoleAdminUser = mysqlTable(
  'byline_admin_role_admin_user',
  {
    admin_role_id: uuidChar('admin_role_id').notNull(),
    admin_user_id: uuidChar('admin_user_id').notNull(),
    ...createdAt,
  },
  (table) => [
    foreignKey({
      name: 'fk_admin_role_admin_user_admin_role_id',
      columns: [table.admin_role_id],
      foreignColumns: [adminRoles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_admin_role_admin_user_admin_user_id',
      columns: [table.admin_user_id],
      foreignColumns: [adminUsers.id],
    }).onDelete('cascade'),
    primaryKey({ columns: [table.admin_role_id, table.admin_user_id] }),
    index('idx_byline_admin_role_admin_user_user').on(table.admin_user_id),
  ]
)

// ---------------------------------------------------------------------------
// byline_admin_permissions — one row per (role, ability) grant
// ---------------------------------------------------------------------------

export const adminPermissions = mysqlTable(
  'byline_admin_permissions',
  {
    id: uuidChar('id').primaryKey(),
    vid: int('vid').notNull().default(1),
    admin_role_id: uuidChar('admin_role_id').notNull(),
    /** Flat dotted ability key — see `@byline/auth` AbilityRegistry. */
    ability: varchar('ability', { length: 128 }).notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_admin_permissions_admin_role_id',
      columns: [table.admin_role_id],
      foreignColumns: [adminRoles.id],
    }).onDelete('cascade'),
    unique('uq_byline_admin_permissions_role_ability').on(table.admin_role_id, table.ability),
    index('idx_byline_admin_permissions_role').on(table.admin_role_id),
  ]
)

// ---------------------------------------------------------------------------
// byline_admin_refresh_tokens — JWT session provider's refresh-token store
// ---------------------------------------------------------------------------

/**
 * Refresh tokens are opaque random strings minted by `JwtSessionProvider`.
 * We never store the plaintext — only a SHA-256 hash (`token_hash`). When
 * a token is rotated, `revoked_at` is stamped and `rotated_to_id` points
 * at the replacement row; presenting a rotated token is treated as replay
 * and revokes the whole chain.
 */
export const adminRefreshTokens = mysqlTable(
  'byline_admin_refresh_tokens',
  {
    id: uuidChar('id').primaryKey(),
    admin_user_id: uuidChar('admin_user_id').notNull(),
    /** SHA-256 hex digest of the raw refresh-token string. 64 chars. */
    token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
    issued_at: datetime('issued_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    expires_at: datetime('expires_at', { fsp: 3 }).notNull(),
    revoked_at: datetime('revoked_at', { fsp: 3 }),
    /**
     * When this token was rotated, the id of the new token issued in its
     * place. Self-referential; set atomically alongside `revoked_at`.
     */
    rotated_to_id: uuidChar('rotated_to_id'),
    last_used_at: datetime('last_used_at', { fsp: 3 }),
    user_agent: varchar('user_agent', { length: 512 }),
    ip: varchar('ip', { length: 45 }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'fk_admin_refresh_tokens_admin_user_id',
      columns: [table.admin_user_id],
      foreignColumns: [adminUsers.id],
    }).onDelete('cascade'),
    index('idx_byline_admin_refresh_tokens_user').on(table.admin_user_id),
    index('idx_byline_admin_refresh_tokens_token_hash').on(table.token_hash),
  ]
)

// ---------------------------------------------------------------------------
// Relations (drizzle query helpers)
// ---------------------------------------------------------------------------

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  roleAssignments: many(adminRoleAdminUser),
  refreshTokens: many(adminRefreshTokens),
}))

export const adminRolesRelations = relations(adminRoles, ({ many }) => ({
  userAssignments: many(adminRoleAdminUser),
  permissions: many(adminPermissions),
}))

export const adminRoleAdminUserRelations = relations(adminRoleAdminUser, ({ one }) => ({
  role: one(adminRoles, {
    fields: [adminRoleAdminUser.admin_role_id],
    references: [adminRoles.id],
  }),
  user: one(adminUsers, {
    fields: [adminRoleAdminUser.admin_user_id],
    references: [adminUsers.id],
  }),
}))

export const adminPermissionsRelations = relations(adminPermissions, ({ one }) => ({
  role: one(adminRoles, {
    fields: [adminPermissions.admin_role_id],
    references: [adminRoles.id],
  }),
}))

export const adminRefreshTokensRelations = relations(adminRefreshTokens, ({ one }) => ({
  user: one(adminUsers, {
    fields: [adminRefreshTokens.admin_user_id],
    references: [adminUsers.id],
  }),
}))
