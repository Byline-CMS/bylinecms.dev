/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `AdminUsersRepository` — the DB-adapter-facing contract for the
 * `byline_admin_users` table.
 *
 * The interface deliberately takes **pre-hashed** password strings
 * (`password_hash`) rather than plaintext. Argon2 / bcrypt hashing is a
 * service-layer concern that depends on `@byline/admin/auth` primitives;
 * keeping it out of the repository means the adapter stays unaware of
 * password policy and the hashing library of the day.
 *
 * **Optimistic concurrency.** Content-shaped writes (`update`,
 * `setPasswordHash`, `delete`) take an `expectedVid` and bump the stored
 * `vid` on success. If the stored `vid` does not match `expectedVid` the
 * adapter throws `AdminUsersError(VERSION_CONFLICT)`, signalling a stale
 * client. Admin-intent writes that do not depend on current state
 * (`setEnabled`, login counters) are vid-less — last-writer-wins is the
 * right semantic for those.
 *
 * Adapters (e.g. `@byline/db-postgres`) implement this interface; admin
 * services (`seed-super-admin`, admin-user commands) consume it. No
 * caller should ever construct `AdminUsersRepository` instances directly
 * outside the adapter — use the `AdminStore` bundle passed at
 * `initBylineCore()` time.
 */

/**
 * Public-facing admin-user row — the `password_hash` column is
 * deliberately omitted. Only `getByEmailForSignIn` returns the hash, and
 * only so the session provider can verify it.
 */
export interface AdminUserRow {
  id: string
  vid: number
  given_name: string | null
  family_name: string | null
  username: string | null
  email: string
  remember_me: boolean
  last_login: Date | null
  last_login_ip: string | null
  failed_login_attempts: number
  is_super_admin: boolean
  is_enabled: boolean
  is_email_verified: boolean
  /**
   * Admin interface locale preference. `null` means "use the detection
   * cascade" (cookie → Accept-Language → defaultLocale). Stored as a
   * BCP 47 code; validated at the command layer against the host's
   * `i18n.interface.locales`.
   */
  preferred_locale: string | null
  created_at: Date
  updated_at: Date
}

/**
 * Admin-user row including the PHC password hash. Returned only by
 * `getByEmailForSignIn` — callers must treat it with care (never log,
 * never return to clients).
 */
export interface AdminUserWithPasswordRow extends AdminUserRow {
  password_hash: string
}

export interface CreateAdminUserInput {
  email: string
  /** Pre-hashed PHC string. Service layer hashes plaintext before calling. */
  password_hash: string
  given_name?: string | null
  family_name?: string | null
  username?: string | null
  is_super_admin?: boolean
  is_enabled?: boolean
  is_email_verified?: boolean
  /** Initial locale preference. `null` defers to the detection cascade. */
  preferred_locale?: string | null
}

export interface UpdateAdminUserInput {
  given_name?: string | null
  family_name?: string | null
  username?: string | null
  email?: string
  is_super_admin?: boolean
  is_enabled?: boolean
  is_email_verified?: boolean
  remember_me?: boolean
  /** Pass `null` to clear and fall back to the detection cascade. */
  preferred_locale?: string | null
}

export type AdminUserListOrder =
  | 'given_name'
  | 'family_name'
  | 'email'
  | 'username'
  | 'created_at'
  | 'updated_at'

export interface ListAdminUsersOptions {
  /** 1-based page number. */
  page: number
  /** Page size. Reasonable ceiling applied at the command layer. */
  pageSize: number
  /** Free-text search across email, given_name, family_name, username. */
  query?: string
  /** Column to sort by. */
  order: AdminUserListOrder
  /** True for DESC, false for ASC. */
  desc: boolean
}

export interface CountAdminUsersOptions {
  /** Free-text search — same semantics as `list`. */
  query?: string
}

export interface AdminUsersRepository {
  create(input: CreateAdminUserInput): Promise<AdminUserRow>
  getById(id: string): Promise<AdminUserRow | null>
  /**
   * Bulk lookup for audit actor-label resolution (the `actors`
   * map on admin document reads — see docs/06-auth-and-security/02-auditability.md, Workstream 1). Ids
   * with no matching row are simply absent from the result; callers
   * render a tombstone label for them.
   */
  getByIds(ids: string[]): Promise<AdminUserRow[]>
  getByEmail(email: string): Promise<AdminUserRow | null>
  getByUsername(username: string): Promise<AdminUserRow | null>
  /**
   * Sign-in-only lookup. Returns the PHC hash alongside the public row so
   * the session provider can verify. Callers **must not** persist or echo
   * the `password_hash` field.
   */
  getByEmailForSignIn(email: string): Promise<AdminUserWithPasswordRow | null>
  /**
   * Authenticated-verification lookup. Same shape as
   * `getByEmailForSignIn` but keyed by id — used by the self-service
   * change-password flow, where the actor is already authenticated and
   * we need to verify the *current* password before swapping in a new
   * one. Same handling rules apply: callers **must not** persist or
   * echo the `password_hash` field.
   */
  getByIdForSignIn(id: string): Promise<AdminUserWithPasswordRow | null>
  /** Paginated, filtered, sorted list. */
  list(options: ListAdminUsersOptions): Promise<AdminUserRow[]>
  /** Total row count matching the same filter (for pager `total_pages`). */
  count(options?: CountAdminUsersOptions): Promise<number>
  /**
   * Content update with optimistic concurrency. Throws
   * `AdminUsersError(VERSION_CONFLICT)` if the stored `vid` differs from
   * `expectedVid`. Bumps `vid` on success and returns the fresh row.
   */
  update(id: string, expectedVid: number, patch: UpdateAdminUserInput): Promise<AdminUserRow>
  /**
   * Replace the stored password hash with optimistic concurrency.
   * Version-gated on `expectedVid`. Caller supplies a pre-hashed PHC string.
   * Returns the updated row so callers holding the edit form can refresh
   * their cached `vid` without a second round-trip.
   */
  setPasswordHash(id: string, expectedVid: number, passwordHash: string): Promise<AdminUserRow>
  /** Toggle enabled state. Vid-less — admin intent is independent of other edits. */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /**
   * Set the admin interface locale preference. Vid-less — user preference
   * is independent of content state. Pass `null` to clear and fall back
   * to the detection cascade (cookie → Accept-Language → defaultLocale).
   */
  setPreferredLocale(id: string, locale: string | null): Promise<void>
  recordLoginSuccess(id: string, ip: string | null): Promise<void>
  recordLoginFailure(id: string): Promise<void>
  /**
   * Delete with optimistic concurrency. Version-gated on `expectedVid` to
   * prevent races against a concurrent update.
   */
  delete(id: string, expectedVid: number): Promise<void>
}
