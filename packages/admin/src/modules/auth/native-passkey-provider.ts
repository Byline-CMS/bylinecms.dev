/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) Infonomic Company Limited
 */

import { createHash, randomBytes } from 'node:crypto'

import {
  type AdminAuth,
  AuthError,
  AuthErrorCodes,
  ERR_FORBIDDEN,
  ERR_INVALID_CREDENTIALS,
  ERR_INVALID_TOKEN,
  ERR_SESSION_CHANGED,
  type PasskeyAdmissionReason,
  type PasskeyAuthenticationOptions,
  type PasskeyCeremony,
  type PasskeyCredentialSummary,
  type PasskeyManagementAction,
  type PasskeyManagementGrant,
  type PasskeyOperation,
  type PasskeyProvider,
  type PasskeyRegistrationOptions,
  type PasskeyRequestMetadata,
  type PasskeySession,
  type SignInResult,
  type SignInWithPasswordArgs,
} from '@byline/auth'
import { type PasskeyConfig, resolvePasskeyConfig } from '@byline/core'
import { passwordSignInSchema } from '@byline/core/validation'
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { v7 as uuidv7, validate as validUuid } from 'uuid'

import { ADMIN_USERS_ABILITIES } from '../admin-users/abilities.js'
import { assertPasskeyBytes } from './passkey-storage-validation.js'
import { verifyPassword } from './password.js'
import type { AdminStore } from '../../store.js'
import type { AdminUserWithPasswordRow } from '../admin-users/repository.js'
import type { NativeSessionEvent } from './jwt-session-provider.js'
import type { PasskeyAttemptRow, PasskeyCredentialRow } from './passkeys-repository.js'

type Authenticated = { actor: AdminAuth; user: AdminUserWithPasswordRow; sessionId: string }
type SignInArgs = Pick<
  SignInWithPasswordArgs,
  'previousAccessToken' | 'previousRefreshToken' | 'ip' | 'userAgent'
>
type PasskeyEvent = Extract<NativeSessionEvent, { purpose: string }>
interface NativeDependencies {
  store: AdminStore
  now(): Date
  authenticate(session: PasskeySession, store?: AdminStore): Promise<Authenticated>
  /** Private constructor closure supplied only by JwtSessionProvider; never publicly exported. */
  signIn(
    snapshot: AdminUserWithPasswordRow,
    args: SignInArgs,
    recheck: (store: AdminStore, user: AdminUserWithPasswordRow) => Promise<void>
  ): Promise<SignInResult>
  emit(event: PasskeyEvent): void
}
const MAX_PENDING = 5
const MAX_CREDENTIALS = 10
const LIFETIME_MS = 300_000

/** Internal native implementation. Public callers enter through SessionProvider.passkeys. */
export class NativePasskeyProvider implements PasskeyProvider {
  readonly #trust: PasskeyConfig
  constructor(
    trust: PasskeyConfig,
    private readonly deps: NativeDependencies
  ) {
    const resolved = resolvePasskeyConfig(trust, {
      capabilities: { passkeys: true, passwordChange: true, magicLink: false, sso: false },
      passkeys: this,
    })
    if (!resolved) throw new Error('Passkey trust configuration is required')
    this.#trust = resolved
  }

  recordAdmissionDenied(purpose: PasskeyOperation, reason: PasskeyAdmissionReason): void {
    this.deps.emit({ type: 'passkey_admission_denied', purpose, reason })
  }

  signInOptions(
    _metadata: PasskeyRequestMetadata
  ): Promise<PasskeyCeremony<PasskeyAuthenticationOptions>> {
    return this.#run('sign-in-options', async () => {
      const { raw, row } = this.#newAttempt('sign-in')
      const options = await this.#authenticationOptions(row.challenge!)
      await this.deps.store.passkeys.createAttempt(row)
      return { ceremonyId: raw, expiresAt: row.expires_at.toISOString(), options }
    })
  }

  verifySignIn(
    args: SignInArgs & { ceremonyId: string; response: unknown }
  ): Promise<SignInResult> {
    return this.#run('sign-in', async () => {
      const attempt = await this.deps.store.passkeys.claimAttempt({
        tokenHash: hashBearer(args.ceremonyId),
        purpose: 'sign-in',
        binding: { actor_user_id: null, actor_login_id: null, actor_generation: null },
        now: this.deps.now(),
      })
      if (!attempt) throw expired()
      const response = parseResponse(args.response, 'webauthn.get') as AuthenticationResponseJSON
      const key = active(await this.deps.store.passkeys.findCredentialByCredentialId(response.id))
      const user = await this.deps.store.adminUsers.getByIdForSignIn(key.admin_user_id)
      if (!user?.is_enabled) throw invalidProof()
      const verified = await this.#verifyAuthentication(response, key, attempt)
      return this.deps.signIn(user, args, async (store) => {
        this.#unexpired(attempt)
        await this.#applyVerifiedKey(store, key, verified)
      })
    })
  }

  passwordProof(
    args: PasskeySession & { password: string; action: PasskeyManagementAction }
  ): Promise<PasskeyManagementGrant> {
    return this.#run('password-proof', async () => {
      const observed = await this.deps.authenticate(args)
      const parsed = passwordSignInSchema.safeParse({
        email: observed.user.email,
        password: args.password,
      })
      if (
        !parsed.success ||
        !(await verifyPassword(parsed.data.password, observed.user.password_hash))
      )
        throw invalidProof()
      return this.deps.store.withSessionLock(observed.user.id, async (store) => {
        const current = await this.deps.authenticate(args, store)
        if (
          current.user.password_hash !== observed.user.password_hash ||
          current.user.session_version !== observed.user.session_version
        )
          throw invalidProof()
        const action = await this.#authorizeAction(args.action, current, store)
        return this.#grant(store, current, action, null)
      })
    })
  }

  proofOptions(
    args: PasskeySession & { action: PasskeyManagementAction }
  ): Promise<PasskeyCeremony<PasskeyAuthenticationOptions>> {
    return this.#run('proof-options', async () => {
      const observed = await this.deps.authenticate(args)
      return this.deps.store.withSessionLock(observed.user.id, async (store) => {
        const current = await this.deps.authenticate(args, store)
        const action = await this.#authorizeAction(args.action, current, store)
        await this.#capacity(store, current.sessionId)
        const { raw, row } = this.#newAttempt('fresh-authentication', current, action)
        // Discoverable proof requires a returned user handle, just like sign-in.
        const options = await this.#authenticationOptions(row.challenge!)
        await store.passkeys.createAttempt(row)
        return { ceremonyId: raw, expiresAt: row.expires_at.toISOString(), options }
      })
    })
  }

  verifyProof(
    args: PasskeySession & { ceremonyId: string; response: unknown }
  ): Promise<PasskeyManagementGrant> {
    return this.#run('proof', async () => {
      const observed = await this.deps.authenticate(args)
      const attempt = await this.#claimAuthenticated(
        args.ceremonyId,
        'fresh-authentication',
        observed
      )
      const response = parseResponse(args.response, 'webauthn.get') as AuthenticationResponseJSON
      const key = active(await this.deps.store.passkeys.findCredentialByCredentialId(response.id))
      if (key.admin_user_id !== observed.user.id) throw invalidProof()
      const verified = await this.#verifyAuthentication(response, key, attempt)
      return this.deps.store.withSessionLock(observed.user.id, async (store) => {
        const current = await this.deps.authenticate(args, store)
        await this.#recheckAuthority(store, attempt, current)
        const action = await this.#authorizeAction(actionOf(attempt), current, store)
        await this.#applyVerifiedKey(store, key, verified)
        return this.#grant(store, current, action, key.id)
      })
    })
  }

  enrollmentOptions(
    args: PasskeySession & { grantId: string }
  ): Promise<PasskeyCeremony<PasskeyRegistrationOptions>> {
    return this.#run('enrollment-options', async () => {
      const observed = await this.deps.authenticate(args)
      const grant = await this.#claimAuthenticated(args.grantId, 'grant', observed, 'enroll')
      return this.deps.store.withSessionLock(observed.user.id, async (store) => {
        const current = await this.deps.authenticate(args, store)
        await this.#recheckAuthority(store, grant, current)
        await this.#authorizeAction(actionOf(grant), current, store)
        await this.#capacity(store, current.sessionId)
        const existing = await store.passkeys.listCredentials(current.user.id)
        if (existing.length >= MAX_CREDENTIALS) throw limit()
        const handle = await store.passkeys.ensureUserHandle(current.user.id, opaque())
        const { raw, row } = this.#newAttempt('enrollment', current, {
          action: 'enroll',
          target_user_id: current.user.id,
          credential_record_id: null,
        })
        row.expires_at = grant.expires_at
        row.proof_credential_id = grant.proof_credential_id
        const generated = await generateRegistrationOptions({
          rpID: this.#trust.rpId,
          rpName: this.#trust.rpName,
          userName: current.user.email,
          userID: Buffer.from(handle, 'base64url'),
          userDisplayName: current.user.given_name || current.user.email,
          challenge: Buffer.from(row.challenge!, 'base64url'),
          timeout: Math.max(1, grant.expires_at.getTime() - this.deps.now().getTime()),
          attestationType: 'none',
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required',
          },
          excludeCredentials: existing.map((key) => ({ id: key.credential_id })),
          extensions: { credProps: true },
        })
        const options: PasskeyRegistrationOptions = {
          ...generated,
          excludeCredentials: existing.map((key) => ({
            id: key.credential_id,
            type: 'public-key' as const,
          })),
          rp: { id: this.#trust.rpId, name: this.#trust.rpName },
          attestation: 'none',
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required',
          },
          extensions: { credProps: true },
        }
        this.#unexpired(row)
        await store.passkeys.createAttempt(row)
        return { ceremonyId: raw, expiresAt: row.expires_at.toISOString(), options }
      })
    })
  }

  verifyEnrollment(
    args: PasskeySession & { ceremonyId: string; response: unknown; name: string }
  ): Promise<PasskeyCredentialSummary> {
    return this.#run('enrollment', async () => {
      const observed = await this.deps.authenticate(args)
      const attempt = await this.#claimAuthenticated(
        args.ceremonyId,
        'enrollment',
        observed,
        'enroll'
      )
      const name = displayName(args.name)
      const response = parseResponse(args.response, 'webauthn.create') as RegistrationResponseJSON
      // residentKey: 'required' / requireResidentKey enforce discoverability during create().
      // credProps reports client properties and may be omitted; only an explicit false contradicts it.
      if (response.clientExtensionResults.credProps?.rk === false) throw invalidProof()
      const verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: attempt.challenge!,
        expectedOrigin: [...this.#trust.origins],
        expectedRPID: this.#trust.rpId,
        expectedType: 'webauthn.create',
        requireUserVerification: true,
        requireUserPresence: true,
      }).catch(() => {
        throw invalidProof()
      })
      if (
        !verified.verified ||
        !verified.registrationInfo.userVerified ||
        verified.registrationInfo.credential.id !== response.id
      )
        throw invalidProof()
      const info = verified.registrationInfo
      return this.deps.store.withSessionLock(observed.user.id, async (store) => {
        const current = await this.deps.authenticate(args, store)
        await this.#recheckAuthority(store, attempt, current)
        await this.#authorizeAction(actionOf(attempt), current, store)
        if ((await store.passkeys.listCredentials(current.user.id)).length >= MAX_CREDENTIALS)
          throw limit()
        if (await store.passkeys.findCredentialByCredentialId(info.credential.id))
          throw invalidProof()
        const row = {
          id: uuidv7(),
          admin_user_id: current.user.id,
          credential_id: info.credential.id,
          public_key: Buffer.from(info.credential.publicKey).toString('base64url'),
          counter: info.credential.counter,
          transports: info.credential.transports ?? [],
          backup_eligible: info.credentialDeviceType === 'multiDevice',
          backed_up: info.credentialBackedUp,
          name,
          created_at: this.deps.now(),
          last_used_at: null,
          revoked_at: null,
        }
        await store.passkeys.createCredential(row)
        return summary(row)
      })
    })
  }

  listCredentials(
    args: PasskeySession & { targetUserId?: string }
  ): Promise<PasskeyCredentialSummary[]> {
    return this.#run('list', async () => {
      const observed = await this.deps.authenticate(args)
      const targetId = args.targetUserId ?? observed.user.id
      if (!validUuid(targetId)) throw forbidden()
      return this.deps.store.withSessionLocks([observed.user.id, targetId], async (store) => {
        const current = await this.deps.authenticate(args, store)
        await this.#authorizeTarget(targetId, current, store)
        return (await store.passkeys.listCredentials(targetId)).map(summary)
      })
    })
  }

  renameCredential(
    args: PasskeySession & { credentialRecordId: string; name: string }
  ): Promise<PasskeyCredentialSummary> {
    return this.#run('rename', async () => {
      const observed = await this.deps.authenticate(args)
      const name = displayName(args.name)
      if (!validUuid(args.credentialRecordId)) throw forbidden()
      return this.deps.store.withSessionLock(observed.user.id, async (store) => {
        const current = await this.deps.authenticate(args, store)
        const key = active(await store.passkeys.findCredential(args.credentialRecordId))
        if (key.admin_user_id !== current.user.id) throw forbidden()
        await store.passkeys.updateCredential(key.id, { name })
        return summary({ ...key, name })
      })
    })
  }

  removeCredential(args: PasskeySession & { grantId: string }): Promise<{ signedOut: boolean }> {
    return this.#run('remove', async () => {
      const observed = await this.deps.authenticate(args)
      const grant = await this.#claimAuthenticated(args.grantId, 'grant', observed, 'remove')
      const action = actionOf(grant)
      if (action.purpose !== 'remove') throw expired()
      const audit = {
        actorId: observed.user.id,
        targetId: action.targetUserId,
        credentialId: action.credentialRecordId,
      }
      try {
        return await this.deps.store.withSessionLocks(
          [observed.user.id, action.targetUserId],
          async (store) => {
            const current = await this.deps.authenticate(args, store)
            await this.#recheckAuthority(store, grant, current)
            await this.#authorizeAction(action, current, store)
            await store.passkeys.revokeCredential(action.credentialRecordId, this.deps.now())
            await store.passkeys.invalidateAccountLogins(action.targetUserId, this.deps.now())
            if (current.user.id !== action.targetUserId)
              await store.passkeys.appendRemovalAudit({ ...audit, outcome: 'success' })
            return { signedOut: current.user.id === action.targetUserId }
          }
        )
      } catch (error) {
        if (observed.user.id !== action.targetUserId) {
          await this.deps.store.passkeys
            .appendRemovalAudit({
              ...audit,
              outcome:
                error instanceof AuthError && error.code === AuthErrorCodes.FORBIDDEN
                  ? 'denied'
                  : 'failed',
            })
            .catch(() => {})
        }
        throw error
      }
    })
  }

  async #run<T>(purpose: PasskeyEvent['purpose'], work: () => Promise<T>): Promise<T> {
    this.deps.emit({ type: 'passkey_attempted', purpose })
    try {
      const result = await work()
      this.deps.emit({ type: 'passkey_completed', purpose })
      return result
    } catch (error) {
      const reason =
        error instanceof AuthError
          ? error.code === AuthErrorCodes.FORBIDDEN
            ? 'forbidden'
            : error.code === AuthErrorCodes.PASSKEY_LIMIT
              ? 'limit'
              : error.code === AuthErrorCodes.INVALID_CREDENTIALS
                ? 'invalid-proof'
                : 'stale-authority'
          : 'unavailable'
      this.deps.emit({ type: 'passkey_failed', purpose, reason })
      // Never propagate driver errors or verification-library details containing credential material.
      if (error instanceof AuthError) throw new AuthError(error.code, { message: error.message })
      throw new AuthError(AuthErrorCodes.PASSKEY_UNAVAILABLE, {
        message: 'Passkey service unavailable',
      })
    }
  }

  async #authenticationOptions(challenge: string): Promise<PasskeyAuthenticationOptions> {
    const generated = await generateAuthenticationOptions({
      rpID: this.#trust.rpId,
      challenge: Buffer.from(challenge, 'base64url'),
      timeout: LIFETIME_MS,
      userVerification: 'required',
    })
    return {
      challenge: generated.challenge,
      timeout: generated.timeout,
      rpId: this.#trust.rpId,
      userVerification: 'required',
    }
  }

  #newAttempt(
    purpose: PasskeyAttemptRow['purpose'],
    actor?: Authenticated,
    action?: Pick<PasskeyAttemptRow, 'action' | 'target_user_id' | 'credential_record_id'>
  ) {
    const raw = opaque()
    const now = this.deps.now()
    const row: Omit<PasskeyAttemptRow, 'consumed_at'> = {
      token_hash: hashBearer(raw),
      purpose,
      challenge: purpose === 'grant' ? null : opaque(),
      actor_user_id: actor?.user.id ?? null,
      actor_login_id: actor?.sessionId ?? null,
      actor_generation: actor?.user.session_version ?? null,
      action: action?.action ?? null,
      target_user_id: action?.target_user_id ?? null,
      credential_record_id: action?.credential_record_id ?? null,
      proof_credential_id: null,
      created_at: now,
      expires_at: new Date(now.getTime() + LIFETIME_MS),
    }
    return { raw, row }
  }

  async #claimAuthenticated(
    raw: string,
    purpose: 'fresh-authentication' | 'enrollment' | 'grant',
    actor: Authenticated,
    requiredAction?: 'enroll' | 'remove'
  ) {
    const tokenHash = hashBearer(raw)
    const observed = await this.deps.store.passkeys.findAttempt(tokenHash)
    if (!observed?.action || observed.purpose !== purpose) throw expired()
    const row = await this.deps.store.passkeys.claimAttempt({
      tokenHash,
      purpose,
      action: requiredAction ?? observed.action,
      binding: {
        actor_user_id: actor.user.id,
        actor_login_id: actor.sessionId,
        actor_generation: actor.user.session_version,
      },
      now: this.deps.now(),
    })
    if (!row) throw expired()
    return row
  }

  #unexpired(row: Pick<PasskeyAttemptRow, 'expires_at'>): void {
    if (row.expires_at.getTime() <= this.deps.now().getTime()) throw expired()
  }

  async #recheckAuthority(
    store: AdminStore,
    row: PasskeyAttemptRow,
    actor: Authenticated
  ): Promise<void> {
    this.#unexpired(row)
    if (
      row.actor_user_id !== actor.user.id ||
      row.actor_login_id !== actor.sessionId ||
      row.actor_generation !== actor.user.session_version
    ) {
      throw ERR_SESSION_CHANGED({ message: 'Fresh proof authority changed; start again' })
    }
    if (row.proof_credential_id) {
      const key = active(await store.passkeys.findCredential(row.proof_credential_id))
      if (key.admin_user_id !== actor.user.id) throw invalidProof()
    }
  }

  async #authorizeTarget(targetId: string, actor: Authenticated, store: AdminStore) {
    if (!validUuid(targetId)) throw forbidden()
    const target = await store.adminUsers.getById(targetId)
    if (!target) throw forbidden()
    if (targetId !== actor.user.id) {
      actor.actor.assertAbility(ADMIN_USERS_ABILITIES.managePasskeys)
      if (target.is_super_admin && !actor.actor.isSuperAdmin) throw forbidden()
    }
    return target
  }

  async #authorizeAction(action: PasskeyManagementAction, actor: Authenticated, store: AdminStore) {
    if (action?.purpose === 'enroll')
      return {
        action: 'enroll' as const,
        target_user_id: actor.user.id,
        credential_record_id: null,
      }
    if (action?.purpose !== 'remove' || !validUuid(action.credentialRecordId)) throw forbidden()
    await this.#authorizeTarget(action.targetUserId, actor, store)
    const key = active(await store.passkeys.findCredential(action.credentialRecordId))
    if (key.admin_user_id !== action.targetUserId) throw forbidden()
    return {
      action: 'remove' as const,
      target_user_id: action.targetUserId,
      credential_record_id: key.id,
    }
  }

  async #capacity(store: AdminStore, sessionId: string) {
    if ((await store.passkeys.countPendingForLogin(sessionId, this.deps.now())) >= MAX_PENDING)
      throw limit()
  }

  async #grant(
    store: AdminStore,
    actor: Authenticated,
    action: Pick<PasskeyAttemptRow, 'action' | 'target_user_id' | 'credential_record_id'>,
    proofCredential: string | null
  ): Promise<PasskeyManagementGrant> {
    await this.#capacity(store, actor.sessionId)
    const { raw, row } = this.#newAttempt('grant', actor, action)
    row.proof_credential_id = proofCredential
    await store.passkeys.createAttempt(row)
    return { grantId: raw, expiresAt: row.expires_at.toISOString() }
  }

  async #verifyAuthentication(
    response: AuthenticationResponseJSON,
    key: PasskeyCredentialRow & { admin_user_id: string },
    attempt: PasskeyAttemptRow
  ) {
    const handle = await this.deps.store.passkeys.getUserHandle(key.admin_user_id)
    if (!handle || response.response.userHandle !== handle) throw invalidProof()
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: attempt.challenge!,
      expectedOrigin: [...this.#trust.origins],
      expectedRPID: this.#trust.rpId,
      expectedType: 'webauthn.get',
      requireUserVerification: true,
      credential: {
        id: key.credential_id,
        publicKey: Buffer.from(key.public_key, 'base64url'),
        counter: key.counter,
      },
    }).catch(() => {
      throw invalidProof()
    })
    if (
      !result.verified ||
      !result.authenticationInfo.userVerified ||
      (result.authenticationInfo.credentialDeviceType === 'multiDevice') !== key.backup_eligible
    )
      throw invalidProof()
    return result.authenticationInfo
  }

  async #applyVerifiedKey(
    store: AdminStore,
    snapshot: PasskeyCredentialRow & { admin_user_id: string },
    verified: { newCounter: number; credentialBackedUp: boolean }
  ) {
    const current = active(await store.passkeys.findCredential(snapshot.id))
    for (const field of [
      'admin_user_id',
      'credential_id',
      'public_key',
      'counter',
      'backup_eligible',
      'backed_up',
    ] as const) {
      if (current[field] !== snapshot[field]) throw invalidProof()
    }
    await store.passkeys.updateCredential(current.id, {
      counter: verified.newCounter,
      backed_up: verified.credentialBackedUp,
      last_used_at: this.deps.now(),
    })
  }
}

function opaque() {
  return randomBytes(32).toString('base64url')
}
function hashBearer(raw: string) {
  try {
    assertPasskeyBytes(raw, 32, 32)
  } catch {
    throw expired()
  }
  return createHash('sha256').update(raw).digest('hex')
}
function expired() {
  return ERR_INVALID_TOKEN({ message: 'Passkey attempt expired or already used; start again' })
}
function invalidProof() {
  return ERR_INVALID_CREDENTIALS({ message: 'Passkey verification failed; start again' })
}
function forbidden() {
  return ERR_FORBIDDEN({ message: 'Passkey management is not permitted' })
}
function limit() {
  return new AuthError(AuthErrorCodes.PASSKEY_LIMIT, {
    message: 'Passkey credential or pending-operation limit reached',
  })
}
function active(
  row: PasskeyCredentialRow | null
): PasskeyCredentialRow & { admin_user_id: string } {
  if (!row || row.revoked_at !== null || row.admin_user_id === null) throw invalidProof()
  return row as PasskeyCredentialRow & { admin_user_id: string }
}
function displayName(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) throw forbidden()
  return value
}
function summary(row: PasskeyCredentialRow): PasskeyCredentialSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  }
}
function actionOf(row: PasskeyAttemptRow): PasskeyManagementAction {
  if (row.action === 'enroll') return { purpose: 'enroll' }
  if (row.action === 'remove' && row.target_user_id && row.credential_record_id) {
    return {
      purpose: 'remove',
      targetUserId: row.target_user_id,
      credentialRecordId: row.credential_record_id,
    }
  }
  throw expired()
}

/** Bound structure and reject iframe ceremonies without changing the signed bytes. */
function parseResponse(
  value: unknown,
  expectedType: 'webauthn.get' | 'webauthn.create'
): AuthenticationResponseJSON | RegistrationResponseJSON {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Buffer.byteLength(JSON.stringify(value)) > 64 * 1024
    )
      throw invalidProof()
    const response = value as AuthenticationResponseJSON | RegistrationResponseJSON
    if (
      response.type !== 'public-key' ||
      response.id !== response.rawId ||
      !response.response ||
      typeof response.response !== 'object' ||
      !response.clientExtensionResults ||
      typeof response.clientExtensionResults !== 'object'
    )
      throw invalidProof()
    assertPasskeyBytes(response.id, 1024)
    assertPasskeyBytes(response.response.clientDataJSON, 16 * 1024)
    const client = JSON.parse(
      Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')
    )
    if (
      !client ||
      client.type !== expectedType ||
      (client.crossOrigin !== undefined && client.crossOrigin !== false)
    )
      throw invalidProof()
    if (expectedType === 'webauthn.get') {
      const auth = response as AuthenticationResponseJSON
      assertPasskeyBytes(auth.response.authenticatorData, 16 * 1024)
      assertPasskeyBytes(auth.response.signature, 16 * 1024)
      assertPasskeyBytes(auth.response.userHandle ?? '', 32, 32)
    } else {
      assertPasskeyBytes(
        (response as RegistrationResponseJSON).response.attestationObject,
        48 * 1024
      )
    }
    return response
  } catch {
    throw invalidProof()
  }
}
