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
  ERR_ACCOUNT_DISABLED,
  ERR_INVALID_CREDENTIALS,
  ERR_INVALID_TOKEN,
  ERR_REVOKED_TOKEN,
  type RefreshSessionArgs,
  type SessionProvider,
  type SessionProviderCapabilities,
  type SessionTokens,
  type SignInResult,
  type SignInWithPasswordArgs,
} from '@byline/auth'
import { jwtVerify, SignJWT } from 'jose'
import { v7 as uuidv7 } from 'uuid'

import { verifyPassword } from './password.js'
import { resolveActor } from './resolve-actor.js'
import type { AdminStore } from '../../store.js'

const DEFAULT_ISSUER = 'byline'
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60 // 15 minutes
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

const CAPABILITIES: SessionProviderCapabilities = {
  passwordChange: true,
  magicLink: false,
  sso: false,
}

export interface JwtSessionProviderConfig {
  /**
   * Adapter-backed admin repositories. Construct via the DB adapter's
   * admin-store factory (e.g. `createAdminStore(db)` from
   * `@byline/db-postgres/auth`) and pass the result in — the provider
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

  readonly #store: AdminStore
  readonly #signingKey: Uint8Array
  readonly #issuer: string
  readonly #accessTtl: number
  readonly #refreshTtl: number
  readonly #now: () => Date

  constructor(config: JwtSessionProviderConfig) {
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
    const users = this.#store.adminUsers
    const row = await users.getByEmailForSignIn(args.email)

    // Uniform error response for unknown email vs. wrong password — don't
    // leak which one. Still do a real verify against a dummy hash so the
    // timing is comparable; the argon2 cost dominates regardless.
    if (!row) {
      await verifyPassword(args.password, DUMMY_HASH_FOR_TIMING)
      throw ERR_INVALID_CREDENTIALS({ message: 'invalid credentials' })
    }

    const ok = await verifyPassword(args.password, row.password_hash)
    if (!ok) {
      await users.recordLoginFailure(row.id)
      throw ERR_INVALID_CREDENTIALS({ message: 'invalid credentials' })
    }

    if (!row.is_enabled) {
      throw ERR_ACCOUNT_DISABLED({ message: 'account disabled' })
    }

    await users.recordLoginSuccess(row.id, args.ip ?? null)

    const actor = await resolveActor(this.#store, row.id)
    // resolveActor also checks is_enabled, but we just recorded success
    // above, so null here would indicate a race (the account was disabled
    // between the check and the resolve). Treat as disabled.
    if (!actor) {
      throw ERR_ACCOUNT_DISABLED({ message: 'account disabled' })
    }

    const tokens = await this.#issueTokens({
      adminUserId: row.id,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
    })

    return { ...tokens, actor }
  }

  async verifyAccessToken(token: string): Promise<{ actor: AdminAuth }> {
    let payload: AccessTokenPayload
    try {
      const result = await jwtVerify<AccessTokenPayload>(token, this.#signingKey, {
        issuer: this.#issuer,
      })
      payload = result.payload
    } catch (err) {
      throw ERR_INVALID_TOKEN({ message: 'access token verification failed', cause: err })
    }

    if (payload.typ !== 'access') {
      throw ERR_INVALID_TOKEN({ message: 'unexpected token type' })
    }

    const actor = await resolveActor(this.#store, payload.sub)
    if (!actor) {
      // The token was valid but the user is now disabled or deleted.
      throw ERR_ACCOUNT_DISABLED({ message: 'account disabled or deleted' })
    }

    return { actor }
  }

  async refreshSession(args: RefreshSessionArgs): Promise<SessionTokens> {
    const refreshTokens = this.#store.refreshTokens
    const hash = hashToken(args.refreshToken)
    const row = await refreshTokens.findByHash(hash)

    if (!row) {
      throw ERR_INVALID_TOKEN({ message: 'refresh token not recognised' })
    }

    const now = this.#now()

    // Already revoked?
    if (row.revoked_at != null) {
      if (row.rotated_to_id != null) {
        // Rotated token replayed — the chain is compromised. Revoke every
        // descendant so the attacker and the legitimate holder are both
        // signed out.
        await refreshTokens.revokeChain(row.id, now)
        throw ERR_REVOKED_TOKEN({
          message: 'refresh token was already rotated — chain revoked',
        })
      }
      throw ERR_REVOKED_TOKEN({ message: 'refresh token has been revoked' })
    }

    if (row.expires_at.getTime() <= now.getTime()) {
      throw ERR_INVALID_TOKEN({ message: 'refresh token expired' })
    }

    // Rotate: mint a new token, mark the old one rotated_to the new id.
    const newId = uuidv7()
    const newRefreshPlain = generateOpaqueToken()
    const newRefreshHash = hashToken(newRefreshPlain)
    const refreshExpiresAt = new Date(now.getTime() + this.#refreshTtl * 1000)

    await refreshTokens.issue({
      id: newId,
      admin_user_id: row.admin_user_id,
      token_hash: newRefreshHash,
      expires_at: refreshExpiresAt,
      user_agent: args.userAgent ?? null,
      ip: args.ip ?? null,
    })
    await refreshTokens.markRotated(row.id, newId, now)

    const accessToken = await this.#signAccessToken(row.admin_user_id, now)
    const accessExpiresAt = new Date(now.getTime() + this.#accessTtl * 1000)

    return {
      accessToken,
      refreshToken: newRefreshPlain,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
    }
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const refreshTokens = this.#store.refreshTokens
    const row = await refreshTokens.findByHash(hashToken(refreshToken))
    if (!row) return // Idempotent — unknown tokens are a no-op.
    await refreshTokens.revoke(row.id, this.#now())
  }

  async resolveActor(adminUserId: string): Promise<AdminAuth | null> {
    return resolveActor(this.#store, adminUserId)
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  async #issueTokens(input: {
    adminUserId: string
    ip: string | null
    userAgent: string | null
  }): Promise<SessionTokens> {
    const now = this.#now()
    const refreshTokens = this.#store.refreshTokens

    const accessToken = await this.#signAccessToken(input.adminUserId, now)
    const accessExpiresAt = new Date(now.getTime() + this.#accessTtl * 1000)

    const refreshPlain = generateOpaqueToken()
    const refreshHash = hashToken(refreshPlain)
    const refreshExpiresAt = new Date(now.getTime() + this.#refreshTtl * 1000)
    await refreshTokens.issue({
      id: uuidv7(),
      admin_user_id: input.adminUserId,
      token_hash: refreshHash,
      expires_at: refreshExpiresAt,
      user_agent: input.userAgent,
      ip: input.ip,
    })

    return {
      accessToken,
      refreshToken: refreshPlain,
      accessTokenExpiresAt: accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
    }
  }

  async #signAccessToken(adminUserId: string, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000)
    const exp = iat + this.#accessTtl
    return new SignJWT({ typ: 'access' })
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
