/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PasskeyAttemptRow, PasskeyClaimInput } from './passkeys-repository.js'

/** Canonical encoding makes string identity exactly equivalent to WebAuthn byte identity. */
export function assertPasskeyBytes(value: string, maxBytes: number, exactBytes?: number): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid passkey byte encoding')
  }
  const bytes = Buffer.from(value, 'base64url')
  if (
    bytes.length > maxBytes ||
    (exactBytes !== undefined && bytes.length !== exactBytes) ||
    bytes.toString('base64url') !== value
  )
    throw new Error('Invalid passkey byte encoding')
}

export function assertPasskeyTokenHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid passkey token hash')
}

export function assertPasskeyAttempt(input: Omit<PasskeyAttemptRow, 'consumed_at'>): void {
  assertPasskeyTokenHash(input.token_hash)
  const lifetime = input.expires_at.getTime() - input.created_at.getTime()
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 300_000) {
    throw new Error('Invalid passkey attempt lifetime')
  }
  if (!['sign-in', 'fresh-authentication', 'enrollment', 'grant'].includes(input.purpose)) {
    throw new Error('Invalid passkey attempt purpose')
  }
  if (input.purpose === 'grant') {
    if (input.challenge !== null) throw new Error('Grants cannot contain challenges')
  } else {
    assertPasskeyBytes(input.challenge ?? '', 32, 32)
  }
  if (input.purpose === 'sign-in') {
    if (
      [
        input.actor_user_id,
        input.actor_login_id,
        input.actor_generation,
        input.action,
        input.target_user_id,
        input.credential_record_id,
        input.proof_credential_id,
      ].some((value) => value !== null)
    ) {
      throw new Error('Sign-in attempts cannot carry management authority')
    }
  } else {
    if (
      !input.actor_user_id ||
      !input.actor_login_id ||
      !Number.isSafeInteger(input.actor_generation) ||
      (input.actor_generation ?? -1) < 0
    ) {
      throw new Error('Management attempts require an acting login and generation')
    }
    if (input.action === 'enroll') {
      if (input.target_user_id !== input.actor_user_id || input.credential_record_id !== null) {
        throw new Error('Enrollment must target the actor')
      }
    } else if (input.action === 'remove') {
      if (!input.target_user_id || !input.credential_record_id || input.purpose === 'enrollment') {
        throw new Error('Removal must bind its target account and credential')
      }
    } else throw new Error('Management attempts require an action')
  }
}

/** Runtime callers must obey the same purpose/action boundary as typed callers. */
export function assertPasskeyClaim(input: PasskeyClaimInput): void {
  assertPasskeyTokenHash(input.tokenHash)
  if (input.purpose === 'sign-in') {
    if (
      input.action !== undefined ||
      [
        input.binding.actor_user_id,
        input.binding.actor_login_id,
        input.binding.actor_generation,
      ].some((value) => value !== null)
    ) {
      throw new Error('Sign-in claims require anonymous binding and no action')
    }
  } else {
    if (!['fresh-authentication', 'enrollment', 'grant'].includes(input.purpose)) {
      throw new Error('Invalid passkey claim purpose')
    }
    if (input.action !== 'enroll' && input.action !== 'remove') {
      throw new Error('Authenticated claims require an action')
    }
    if (
      !input.binding.actor_user_id ||
      !input.binding.actor_login_id ||
      !Number.isSafeInteger(input.binding.actor_generation) ||
      input.binding.actor_generation < 0
    ) {
      throw new Error('Authenticated claims require an acting login binding')
    }
  }
}
