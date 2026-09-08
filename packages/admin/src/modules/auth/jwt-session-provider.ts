/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import {
  type AccessTokenPayload,
  type AdminAuth,
  ERR_ACCESS_EXPIRED,
  ERR_ACCOUNT_DISABLED,
  ERR_INVALID_CREDENTIALS,
  ERR_INVALID_TOKEN,
  ERR_REVOKED_TOKEN,
  ERR_SESSION_CHANGED,
  type RefreshSessionArgs,
  type RevokeSessionArgs,
  type SessionProvider,
  type SessionProviderCapabilities,
  type SessionTokens,
  type SignInResult,
  type SignInWithPasswordArgs,
} from '@byline/auth'
import { passwordSignInSchema } from '@byline/core/validation'
import { compactVerify, jwtVerify, SignJWT } from 'jose'
import { v7 as uuidv7 } from 'uuid'

import { verifyPassword } from './password.js'
import { resolveActor, resolveActorFromUser } from './resolve-actor.js'
import type { AdminStore } from '../../store.js'

const DEFAULT_ISSUER = 'byline'
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60 // 15 minutes
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

const CAPABILITIES: SessionProviderCapabilities = {
  passwordChange: true,
  magicLink: false,
  sso: false,
}

export interface NativeSessionEvent {
  type: 'refresh_attempted' | 'refresh_completed' | 'refresh_contested'
}

export interface JwtSessionProviderConfig {
  /** Best-effort, token-free renewal telemetry. Errors never change authentication outcomes. */
  onEvent?: (event: NativeSessionEvent) => void
  /**
   * Adapter-backed admin repositories. Construct via the DB adapter's
   * admin-store factory (e.g. `createAdminStore(db)` from
   * `@byline/db-postgres/admin`) and pass the result in — the provider
   * does not touch Drizzle or any other adapter-specific API directly.
   */
  store: AdminStore
  /**
   * HMAC-SHA256 signing secret. Must be at least 32 bytes (256 bits) of
   * entropy. Load from a secret manager — never hard-code.
   *
   * To switch to asymmetric signing (RS256/EdDSA), swap out this provider
   * for a custom one backed by `jose` key objects.
   */
  signingSecret: string | Uint8Array
  /** Issuer claim (`iss`) on access tokens. Defaults to `'byline'`. */
  issuer?: string
  /** Access-token lifetime in seconds. Default 15 min. */
  accessTokenTtlSeconds?: number
  /** Refresh-token lifetime in seconds. Default 30 days. */
  refreshTokenTtlSeconds?: number
  /** Clock reference — override for deterministic tests. */
  now?: () => Date
}

export class JwtSessionProvider implements SessionProvider {
  public readonly capabilities = CAPABILITIES

  readonly #onEvent?: (event: NativeSessionEvent) => void
  readonly #store: AdminStore
  readonly #signingKey: Uint8Array
  readonly #issuer: string
  readonly #accessTtl: number
  readonly #refreshTtl: number
  readonly #now: () => Date

  constructor(config: JwtSessionProviderConfig) {
    this.#onEvent = config.onEvent
    this.#store = config.store
    this.#signingKey =
      typeof config.signingSecret === 'string'
        ? new TextEncoder().encode(config.signingSecret)
        : config.signingSecret
    if (this.#signingKey.byteLength < 32) {
      throw new Error(
        'JwtSessionProvider: signingSecret must carry at least 32 bytes of entropy (256 bits)'
      )
    }
    this.#issuer = config.issuer ?? DEFAULT_ISSUER
    this.#accessTtl = config.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS
    this.#refreshTtl = config.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS
    this.#now = config.now ?? (() => new Date())
  }

  // -----------------------------------------------------------------------
  // SessionProvider
  // -----------------------------------------------------------------------

  async signInWithPassword(args: SignInWithPasswordArgs): Promise<SignInResult> {
    const credentials = passwordSignInSchema.parse(args)
    const users = this.#store.adminUsers
    const row = await users.getByEmailForSignIn(credentials.email)

    // Uniform error response for unknown email vs. wrong password — don't
    // leak which one. Still do a real verify against a dummy hash so the
    // timing is comparable; the argon2 cost dominates regardless.
    if (!row) {
      await verifyPassword(credentials.password, DUMMY_HASH_FOR_TIMING)
      throw ERR_INVALID_CREDENTIALS({ message: 'invalid credentials' })
    }

    const ok = await verifyPassword(credentials.password, row.password_hash)
    if (!ok) {
      await users.recordLoginFailure(row.id)
      throw ERR_INVALID_CREDENTIALS({ message: 'invalid credentials' })
    }

    if (!row.is_enabled) {
      throw ERR_ACCOUNT_DISABLED({ message: 'account disabled' })
    }

    const previous = await this.#observedLogins(args)
    const withLocks = <T>(work: (store: AdminStore) => Promise<T>) =>
      previous.length
        ? this.#store.withSessionLocks(
            [row.id, ...previous.map((login) => login.admin_user_id)],
            work
          )
        : this.#store.withSessionLock(row.id, (store) => work(store))
    return withLocks(async (store) => {
      const current = await store.adminUsers.getByIdForSignIn(row.id)
      if (!current?.is_enabled) throw ERR_ACCOUNT_DISABLED({ message: 'account disabled' })
      // Password verification is deliberately outside the lock. Revalidate
      // both the credential and generation before issuing under that lock.
      if (
        current.password_hash !== row.password_hash ||
        current.session_version !== row.session_version
      ) {
        throw ERR_INVALID_CREDENTIALS({ message: 'credentials changed during sign-in' })
      }
      for (const observed of previous) {
        const login = await store.loginSessions.findById(observed.id)
        if (login && login.admin_user_id === observed.admin_user_id) {
          await store.loginSessions.revoke(login.id, this.#now())
        }
      }
      await store.adminUsers.recordLoginSuccess(row.id, args.ip ?? null)
      const actor = await resolveActorFromUser(store, current)
      if (!actor) throw ERR_ACCOUNT_DISABLED({ message: 'account disabled' })
      const tokens = await this.#issueTokens(store, {
        adminUserId: row.id,
        sessionVersion: current.session_version,
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
      })
      return { ...tokens, actor }
    })
  }

  async verifyAccessToken(token: string): Promise<{ actor: AdminAuth; sessionId: string }> {
    let payload: AccessTokenPayload
    try {
      const result = await jwtVerify<AccessTokenPayload>(token, this.#signingKey, {
        issuer: this.#issuer,
        algorithms: ['HS256'],
        currentDate: this.#now(),
        requiredClaims: ['sub', 'iat', 'exp', 'jti', 'sv', 'sid'],
      })
      payload = result.payload
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ERR_JWT_EXPIRED') {
        throw ERR_ACCESS_EXPIRED({ message: 'access token expired' })
      }
      throw ERR_INVALID_TOKEN({ message: 'access token verification failed', cause: err })
    }

    if (
      payload.typ !== 'access' ||
      typeof payload.sub !== 'string' ||
      !validSid(payload.sid) ||
      !Number.isSafeInteger(payload.sv) ||
      payload.sv < 0
    ) {
      throw ERR_INVALID_TOKEN({ message: 'unexpected token type' })
    }

    const current = await this.#store.adminUsers.getByIdForSignIn(payload.sub)
    if (!current?.is_enabled) {
      throw ERR_ACCOUNT_DISABLED({ message: 'account disabled or deleted' })
    }
    if (current.session_version !== payload.sv) {
      throw ERR_REVOKED_TOKEN({ message: 'account session generation changed' })
    }
    const login = await this.#store.loginSessions.findById(payload.sid)
    if (
      !login ||
      login.admin_user_id !== payload.sub ||
      login.session_version !== payload.sv ||
      login.revoked_at != null ||
      login.expires_at.getTime() <= this.#now().getTime()
    ) {
      throw ERR_REVOKED_TOKEN({ message: 'login revoked or expired' })
    }
    const actor = await resolveActorFromUser(this.#store, current)
    if (!actor) throw ERR_ACCOUNT_DISABLED({ message: 'account disabled or deleted' })
    return { actor, sessionId: payload.sid }
  }

  async refreshSession(args: RefreshSessionArgs): Promise<SessionTokens> {
    this.#emit('refresh_attempted')
    const hash = hashToken(args.refreshToken)
    const observed = await this.#store.refreshTokens.findByHash(hash)
    if (!observed) throw ERR_INVALID_TOKEN({ message: 'refresh token not recognised' })

    const outcome = await this.#store.withSessionLock(
      observed.admin_user_id,
      async (store, user) => {
        if (!user?.is_enabled)
          throw ERR_ACCOUNT_DISABLED({ message: 'account disabled or deleted' })
        const refreshTokens = store.refreshTokens
        const row = await refreshTokens.findByHash(hash)
        if (!row) throw ERR_INVALID_TOKEN({ message: 'refresh token not recognised' })
        const now = this.#now()
        const login = row.sid ? await store.loginSessions.findById(row.sid) : null
        if (
          !login ||
          login.admin_user_id !== user.id ||
          login.session_version !== user.session_version ||
          login.revoked_at != null
        ) {
          throw ERR_REVOKED_TOKEN({ message: 'login revoked' })
        }
        if (args.expectedSessionId && args.expectedSessionId !== login.id) {
          throw ERR_SESSION_CHANGED({ message: 'session changed before renewal' })
        }
        if (row.revoked_at != null) {
          if (row.rotated_to_id != null) {
            await store.loginSessions.revoke(login.id, now)
            await refreshTokens.revokeChain(row.id, now)
          }
          // Return the error so replay revocation commits before it is thrown.
          // Strict replay revokes this login even if the replayed row is also expired.
          return {
            contested: row.rotated_to_id != null,
            error: ERR_REVOKED_TOKEN({ message: 'refresh token has been revoked' }),
          }
        }
        if (row.session_version !== user.session_version) {
          throw ERR_REVOKED_TOKEN({ message: 'account session generation changed' })
        }
        // Preserve the terminal expiry classification for an ordinary aged-out login.
        // Explicit revocation/replay and generation changes above retain precedence.
        if (
          row.expires_at.getTime() <= now.getTime() ||
          login.expires_at.getTime() <= now.getTime()
        ) {
          throw ERR_INVALID_TOKEN({ message: 'refresh token expired' })
        }
        const newId = uuidv7()
        const newRefreshPlain = generateOpaqueToken()
        const refreshExpiresAt = new Date(now.getTime() + this.#refreshTtl * 1000)
        await refreshTokens.issue({
          id: newId,
          admin_user_id: row.admin_user_id,
          token_hash: hashToken(newRefreshPlain),
          session_version: user.session_version,
          sid: login.id,
          expires_at: refreshExpiresAt,
          user_agent: args.userAgent ?? null,
          ip: args.ip ?? null,
        })
        await store.loginSessions.extend(login.id, refreshExpiresAt)
        await refreshTokens.markRotated(row.id, newId, now)
        const accessToken = await this.#signAccessToken(
          row.admin_user_id,
          user.session_version,
          login.id,
          now
        )
        return {
          tokens: {
            sessionId: login.id,
            accessToken,
            refreshToken: newRefreshPlain,
            accessTokenExpiresAt: new Date(now.getTime() + this.#accessTtl * 1000),
            refreshTokenExpiresAt: refreshExpiresAt,
          },
        }
      }
    )
    if ('error' in outcome) {
      if (outcome.contested) this.#emit('refresh_contested')
      throw outcome.error
    }
    this.#emit('refresh_completed')
    return outcome.tokens
  }

  async revokeSession(args: RevokeSessionArgs): Promise<void> {
    const logins = await this.#observedLogins({
      previousAccessToken: args.accessToken,
      previousRefreshToken: args.refreshToken,
    })
    if (args.expectedSessionId && logins.some((login) => login.id !== args.expectedSessionId))
      throw ERR_SESSION_CHANGED({ message: 'session changed before logout' })
    for (const login of logins) {
      await this.#store.withSessionLock(login.admin_user_id, async (store) => {
        await store.loginSessions.revoke(login.id, this.#now())
      })
    }
    // Also retire a known legacy refresh row. Native rows are denied by login validity.
    if (args.refreshToken) {
      const row = await this.#store.refreshTokens.findByHash(hashToken(args.refreshToken))
      if (row) {
        await this.#store.withSessionLock(row.admin_user_id, async (store) => {
          await store.refreshTokens.revokeChain(row.id, this.#now())
        })
      }
    }
  }

  async resolveActor(adminUserId: string): Promise<AdminAuth | null> {
    return resolveActor(this.#store, adminUserId)
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  #emit(type: NativeSessionEvent['type']) {
    try {
      this.#onEvent?.({ type })
    } catch {
      /* Telemetry is not an authentication dependency. */
    }
  }

  async #observedLogins(
    args: Pick<SignInWithPasswordArgs, 'previousAccessToken' | 'previousRefreshToken'>
  ) {
    const ids = new Set<string>()
    if (args.previousAccessToken) {
      let claims: Record<string, unknown> | undefined
      try {
        const verified = await compactVerify(args.previousAccessToken, this.#signingKey, {
          algorithms: ['HS256'],
        })
        claims = JSON.parse(new TextDecoder().decode(verified.payload))
      } catch {
        /* An invalid credential supplies no revocation authority. */
      }
      if (
        claims?.iss === this.#issuer &&
        claims.typ === 'access' &&
        validSid(claims.sid) &&
        typeof claims.sub === 'string'
      ) {
        const login = await this.#store.loginSessions.findById(claims.sid)
        if (login?.admin_user_id === claims.sub) ids.add(login.id)
      }
    }
    if (args.previousRefreshToken) {
      const token = await this.#store.refreshTokens.findByHash(hashToken(args.previousRefreshToken))
      if (token?.sid) {
        const login = await this.#store.loginSessions.findById(token.sid)
        if (login?.admin_user_id === token.admin_user_id) ids.add(login.id)
      }
    }
    const result = []
    for (const id of ids) {
      const login = await this.#store.loginSessions.findById(id)
      if (login) result.push(login)
    }
    return result
  }

  async #issueTokens(
    store: AdminStore,
    input: {
      sessionVersion: number
      adminUserId: string
      ip: string | null
      userAgent: string | null
    }
  ): Promise<SessionTokens> {
    const now = this.#now()
    const refreshTokens = store.refreshTokens

    const sessionId = randomUUID()
    const accessToken = await this.#signAccessToken(
      input.adminUserId,
      input.sessionVersion,
      sessionId,
      now
    )
    const accessExpiresAt = new Date(now.getTime() + this.#accessTtl * 1000)

    const refreshPlain = generateOpaqueToken()
    const refreshHash = hashToken(refreshPlain)
    const refreshExpiresAt = new Date(now.getTime() + this.#refreshTtl * 1000)
    await store.loginSessions.create({
      id: sessionId,
      admin_user_id: input.adminUserId,
      session_version: input.sessionVersion,
      expires_at: refreshExpiresAt,
    })
    await refreshTokens.issue({
      id: uuidv7(),
      admin_user_id: input.adminUserId,
      token_hash: refreshHash,
      session_version: input.sessionVersion,
      sid: sessionId,
      expires_at: refreshExpiresAt,
      user_agent: input.userAgent,
      ip: input.ip,
    })

    return {
      sessionId,
      accessToken,
      refreshToken: refreshPlain,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
    }
  }

  async #signAccessToken(
    adminUserId: string,
    sessionVersion: number,
    sessionId: string,
    now: Date
  ): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000)
    const exp = iat + this.#accessTtl
    return new SignJWT({ typ: 'access', sv: sessionVersion, sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(adminUserId)
      .setIssuer(this.#issuer)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(randomUUID())
      .sign(this.#signingKey)
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** 32 bytes of randomness, base64url-encoded. ~43 chars on the wire. */
function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 hex digest of the raw refresh-token string. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * A stable argon2id hash used only to equalise sign-in timing on the
 * unknown-email code path. The plaintext here is arbitrary — we never
 * succeed against it. This is pre-generated at module-load time so the
 * first sign-in call doesn't pay the generation cost.
 */
const DUMMY_HASH_FOR_TIMING =
  '$argon2id$v=19$m=19456,t=2,p=1$c2lkZS1jaGFubmVsLW1pdGlnYXRpb24$0Hqf2vQKZqSfZZ4nJRr7K5IOjn9ngjzaQjV+yTG6iNY'

function validSid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}
