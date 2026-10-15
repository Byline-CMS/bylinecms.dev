/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) Infonomic Company Limited
 */

/** Internal persistence records. Never return these through account/editor DTOs. */
export interface PasskeyCredentialRow {
  id: string
  /** Null after account deletion; the credential identity remains reserved. */
  admin_user_id: string | null
  /** Canonical unpadded base64url; byte-exact uniqueness includes revoked records. */
  credential_id: string
  public_key: string
  counter: number
  transports: string[]
  backup_eligible: boolean
  backed_up: boolean
  name: string
  created_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

export interface PasskeyAttemptRow {
  /** SHA-256 hex of the independent bearer identifier; never the identifier itself. */
  token_hash: string
  purpose: 'sign-in' | 'fresh-authentication' | 'enrollment' | 'grant'
  challenge: string | null
  actor_user_id: string | null
  actor_login_id: string | null
  actor_generation: number | null
  action: 'enroll' | 'remove' | null
  target_user_id: string | null
  credential_record_id: string | null
  /** Credential used for fresh proof, if any; revalidated at grant use. */
  proof_credential_id: string | null
  created_at: Date
  expires_at: Date
  consumed_at: Date | null
}

export type PasskeyClaimInput = { tokenHash: string; now: Date } & (
  | {
      purpose: 'sign-in'
      binding: { actor_user_id: null; actor_login_id: null; actor_generation: null }
      action?: never
    }
  | {
      purpose: 'fresh-authentication' | 'enrollment' | 'grant'
      binding: { actor_user_id: string; actor_login_id: string; actor_generation: number }
      action: 'enroll' | 'remove'
    }
)

export interface PasskeysRepository {
  getUserHandle(adminUserId: string): Promise<string | null>
  /** Requires the owning account lock. Allocates once; never resets on credential removal. */
  ensureUserHandle(adminUserId: string, candidate: string): Promise<string>
  /** Includes tombstones: authentication must reject revoked or ownerless records. */
  findCredential(id: string): Promise<PasskeyCredentialRow | null>
  /** Includes tombstones: authentication must reject revoked or ownerless records. */
  findCredentialByCredentialId(credentialId: string): Promise<PasskeyCredentialRow | null>
  listCredentials(adminUserId: string): Promise<PasskeyCredentialRow[]>
  /** All credential writes require the owning account lock and share its transaction. */
  createCredential(
    input: Omit<PasskeyCredentialRow, 'admin_user_id' | 'revoked_at'> & {
      admin_user_id: string
    }
  ): Promise<void>
  updateCredential(
    id: string,
    patch: Partial<Pick<PasskeyCredentialRow, 'counter' | 'backed_up' | 'name' | 'last_used_at'>>
  ): Promise<void>
  revokeCredential(id: string, at: Date): Promise<void>
  /** Authenticated attempts require the actor lock; sign-in has no account yet. */
  createAttempt(input: Omit<PasskeyAttemptRow, 'consumed_at'>): Promise<void>
  findAttempt(tokenHash: string): Promise<PasskeyAttemptRow | null>
  countPendingForLogin(loginId: string, now: Date): Promise<number>
  /**
   * Root store only: commits consumption in its own short transaction BEFORE returning.
   * Calling through an account-transaction store must throw, never create a savepoint.
   * Exact purpose/binding, unconsumed state and expiry gate the sole winning claim.
   * No automatic retries, even if commit acknowledgement is uncertain.
   */
  claimAttempt(input: PasskeyClaimInput): Promise<PasskeyAttemptRow | null>
}
