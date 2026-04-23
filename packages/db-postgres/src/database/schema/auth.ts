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
 * All four tables carry the `byline_` prefix so Byline can coexist with
 * other schemas in a shared database. Content-side tables (documents,
 * document_versions, store_*) are unprefixed today and will be renamed in
 * a dedicated follow-up migration.
 *
 * Shape mirrors the mature Modulus Learning implementation with minor
 * Byline conventions:
 *   - UUIDv7 primary keys (generated at insert time in the repository).
 *   - `vid` integer version column for optimistic concurrency (defaults
 *     to 1; bumped by write paths when needed).
 *   - snake_case column names matching the rest of the Byline schema.
 *
 * See docs/analysis/AUTHN-AUTHZ-ANALYSIS.md for the full data model and
 * phased rollout.
 */

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// byline_admin_users
// ---------------------------------------------------------------------------

export const bylineAdminUsers = pgTable(
  'byline_admin_users',
  {
    id: uuid('id').primaryKey(),
    vid: integer('vid').notNull().default(1),
    given_name: varchar('given_name', { length: 100 }),
    family_name: varchar('family_name', { length: 100 }),
    /** Optional — email is the primary identifier. Unique when present. */
    username: varchar('username', { length: 64 }).unique(),
    email: varchar('email', { length: 254 }).notNull().unique(),
    /** Full PHC string, e.g. `$argon2id$v=19$m=…$…$…`. */
    password: varchar('password', { length: 255 }).notNull(),
    remember_me: boolean('remember_me').notNull().default(false),
    last_login: timestamp('last_login', { precision: 6, withTimezone: true }),
    last_login_ip: varchar('last_login_ip', { length: 45 }),
    failed_login_attempts: integer('failed_login_attempts').notNull().default(0),
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
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('idx_byline_admin_users_email').on(table.email)]
)

// ---------------------------------------------------------------------------
// byline_admin_roles
// ---------------------------------------------------------------------------

export const bylineAdminRoles = pgTable(
  'byline_admin_roles',
  {
    id: uuid('id').primaryKey(),
    vid: integer('vid').notNull().default(1),
    /** Human-readable label, e.g. `'Editor'`. */
    name: varchar('name', { length: 128 }).notNull(),
    /** Stable identifier used in code, e.g. `'editor'`, `'super-admin'`. */
    machine_name: varchar('machine_name', { length: 128 }).notNull().unique(),
    description: text('description'),
    /** Display ordering in the role-editor UI. */
    order: integer('order').notNull().default(0),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('idx_byline_admin_roles_machine_name').on(table.machine_name)]
)

// ---------------------------------------------------------------------------
// byline_admin_role_admin_user — many-to-many join
// ---------------------------------------------------------------------------

export const bylineAdminRoleAdminUser = pgTable(
  'byline_admin_role_admin_user',
  {
    admin_role_id: uuid('admin_role_id')
      .notNull()
      .references(() => bylineAdminRoles.id, { onDelete: 'cascade' }),
    admin_user_id: uuid('admin_user_id')
      .notNull()
      .references(() => bylineAdminUsers.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.admin_role_id, table.admin_user_id] }),
    index('idx_byline_admin_role_admin_user_user').on(table.admin_user_id),
  ]
)

// ---------------------------------------------------------------------------
// byline_admin_permissions — one row per (role, ability) grant
// ---------------------------------------------------------------------------

export const bylineAdminPermissions = pgTable(
  'byline_admin_permissions',
  {
    id: uuid('id').primaryKey(),
    vid: integer('vid').notNull().default(1),
    admin_role_id: uuid('admin_role_id')
      .notNull()
      .references(() => bylineAdminRoles.id, { onDelete: 'cascade' }),
    /** Flat dotted ability key — see `@byline/auth` AbilityRegistry. */
    ability: varchar('ability', { length: 128 }).notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
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
export const bylineAdminRefreshTokens = pgTable(
  'byline_admin_refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    admin_user_id: uuid('admin_user_id')
      .notNull()
      .references(() => bylineAdminUsers.id, { onDelete: 'cascade' }),
    /** SHA-256 hex digest of the raw refresh-token string. 64 chars. */
    token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
    issued_at: timestamp('issued_at', { precision: 6, withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { precision: 6, withTimezone: true }).notNull(),
    revoked_at: timestamp('revoked_at', { precision: 6, withTimezone: true }),
    /**
     * When this token was rotated, the id of the new token issued in its
     * place. Self-referential; set atomically alongside `revoked_at`.
     */
    rotated_to_id: uuid('rotated_to_id'),
    last_used_at: timestamp('last_used_at', { precision: 6, withTimezone: true }),
    user_agent: varchar('user_agent', { length: 512 }),
    ip: varchar('ip', { length: 45 }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_byline_admin_refresh_tokens_user').on(table.admin_user_id),
    index('idx_byline_admin_refresh_tokens_token_hash').on(table.token_hash),
  ]
)

// ---------------------------------------------------------------------------
// Relations (drizzle query helpers)
// ---------------------------------------------------------------------------

export const bylineAdminUsersRelations = relations(bylineAdminUsers, ({ many }) => ({
  roleAssignments: many(bylineAdminRoleAdminUser),
  refreshTokens: many(bylineAdminRefreshTokens),
}))

export const bylineAdminRolesRelations = relations(bylineAdminRoles, ({ many }) => ({
  userAssignments: many(bylineAdminRoleAdminUser),
  permissions: many(bylineAdminPermissions),
}))

export const bylineAdminRoleAdminUserRelations = relations(bylineAdminRoleAdminUser, ({ one }) => ({
  role: one(bylineAdminRoles, {
    fields: [bylineAdminRoleAdminUser.admin_role_id],
    references: [bylineAdminRoles.id],
  }),
  user: one(bylineAdminUsers, {
    fields: [bylineAdminRoleAdminUser.admin_user_id],
    references: [bylineAdminUsers.id],
  }),
}))

export const bylineAdminPermissionsRelations = relations(bylineAdminPermissions, ({ one }) => ({
  role: one(bylineAdminRoles, {
    fields: [bylineAdminPermissions.admin_role_id],
    references: [bylineAdminRoles.id],
  }),
}))

export const bylineAdminRefreshTokensRelations = relations(bylineAdminRefreshTokens, ({ one }) => ({
  user: one(bylineAdminUsers, {
    fields: [bylineAdminRefreshTokens.admin_user_id],
    references: [bylineAdminUsers.id],
  }),
}))
