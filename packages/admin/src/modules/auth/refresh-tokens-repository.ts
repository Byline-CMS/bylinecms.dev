/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `RefreshTokensRepository` — the persistence contract for the
 * `byline_admin_refresh_tokens` table.
 *
 * Lives under `modules/auth` rather than at the package root because this
 * table exists to serve the built-in JWT session provider — a third-party
 * session provider (Lucia, WorkOS, Clerk) would not use it. `token_hash`
 * stores the SHA-256 of the plaintext refresh token; the plaintext leaves
 * the server exactly once, when it is issued to the caller.
 */

export interface RefreshTokenRow {
  id: string
  admin_user_id: string
  token_hash: string
  issued_at: Date
  expires_at: Date
  revoked_at: Date | null
  rotated_to_id: string | null
  last_used_at: Date | null
  user_agent: string | null
  ip: string | null
}

export interface IssueRefreshTokenInput {
  id: string
  admin_user_id: string
  token_hash: string
  expires_at: Date
  user_agent?: string | null
  ip?: string | null
}

export interface RefreshTokensRepository {
  /** Insert a new refresh-token row. `id` is supplied by the caller (UUIDv7). */
  issue(input: IssueRefreshTokenInput): Promise<RefreshTokenRow>
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>
  findById(id: string): Promise<RefreshTokenRow | null>
  /** Stamp `last_used_at` for observability. */
  touch(id: string, at?: Date): Promise<void>
  /**
   * Atomically revoke `oldId` and set its `rotated_to_id` to `newId`.
   * Caller is responsible for inserting the new row (via `issue`) before
   * calling this — ordering is a contract.
   */
  markRotated(oldId: string, newId: string, at?: Date): Promise<void>
  /** Revoke a single token. Idempotent. */
  revoke(id: string, at?: Date): Promise<void>
  /**
   * Walk the rotation chain starting at `startId` and revoke every token
   * in it. Called when a rotated token is replayed — indicates the chain
   * has been compromised and every descendant is suspect. Returns the
   * number of rows touched.
   */
  revokeChain(startId: string, at?: Date): Promise<number>
  /** Revoke every non-revoked token for a user. Used on password change / sign-out everywhere. */
  revokeAllForUser(adminUserId: string, at?: Date): Promise<number>
  /** Remove rows whose `expires_at` is in the past. Housekeeping. */
  purgeExpired(now?: Date): Promise<number>
  /** All non-revoked tokens for a user. Primarily for tests. */
  listActiveForUser(adminUserId: string): Promise<RefreshTokenRow[]>
  /** All tokens (including revoked) for a user. Primarily for tests and debugging. */
  listAllForUser(adminUserId: string): Promise<RefreshTokenRow[]>
  /** All tokens descended from `startId` via the rotation chain. Utility for tests. */
  listRotationChain(startId: string): Promise<RefreshTokenRow[]>
}
