/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Session provider — the transport-agnostic contract for authenticating
 * admin users and managing session tokens.
 *
 * The built-in `JwtSessionProvider` (in `@byline/db-postgres/auth`) mints
 * short-lived JWT access tokens and long-lived opaque refresh tokens,
 * storing refresh-token hashes in `byline_admin_refresh_tokens` for
 * revocation and replay detection.
 *
 * Alternative providers can adapt Lucia, better-auth, WorkOS, Clerk, or an
 * institutional SSO/IdP by implementing this surface. `capabilities` lets
 * the admin UI render affordances appropriate to whatever provider is
 * wired up.
 *
 * See docs/analysis/AUTHN-AUTHZ-ANALYSIS.md §7.
 */

import type { AdminAuth } from './actor.js'

/**
 * Decoded access-token payload. `JwtSessionProvider` issues this shape;
 * alternative providers may attach additional claims but must at minimum
 * carry the `sub` (admin user id) so `verifyAccessToken` can resolve the
 * actor.
 */
export interface AccessTokenPayload {
  /** Admin user id (UUIDv7). */
  sub: string
  /** Issued-at (seconds since epoch). */
  iat: number
  /** Expires-at (seconds since epoch). */
  exp: number
  /** Issuer identifier — `'byline'` for the built-in provider. */
  iss: string
  /** JWT id. Unique per issuance so same-second re-issuance produces distinct tokens. */
  jti: string
  /** Token type discriminator — `'access'` for access tokens. */
  typ: 'access'
}

/** Returned by `signInWithPassword` and `refreshSession`. */
export interface SessionTokens {
  /** Short-lived (typically 15 min). Sent on every authenticated request. */
  accessToken: string
  /**
   * Long-lived (typically 30 days). Opaque random string in the built-in
   * provider; alternative providers may use their own format. Client
   * stores this in an http-only cookie or secure storage.
   */
  refreshToken: string
  /** Seconds-from-now at which `accessToken` expires. */
  accessTokenExpiresAt: Date
  /** Seconds-from-now at which `refreshToken` expires. */
  refreshTokenExpiresAt: Date
}

export interface SignInResult extends SessionTokens {
  actor: AdminAuth
}

export interface SignInWithPasswordArgs {
  email: string
  password: string
  /** Client IP — recorded on the refresh-token row for observability. */
  ip?: string
  /** Client User-Agent — recorded on the refresh-token row for observability. */
  userAgent?: string
}

export interface RefreshSessionArgs {
  refreshToken: string
  ip?: string
  userAgent?: string
}

/**
 * Capability flags. The admin UI consults these when rendering sign-in
 * affordances — e.g. hide the "change password" button when the provider
 * delegates credential management to an external IdP, show a "Sign in
 * with SSO" button when appropriate.
 */
export interface SessionProviderCapabilities {
  /** Can callers change their password through this provider? */
  passwordChange: boolean
  /** Does the provider support magic-link sign-in? */
  magicLink: boolean
  /** Does the provider delegate to an SSO/IdP (SAML, OIDC, etc.)? */
  sso: boolean
}

export interface SessionProvider {
  /** Verify email + password, return fresh tokens and the resolved actor. */
  signInWithPassword(args: SignInWithPasswordArgs): Promise<SignInResult>

  /**
   * Verify an access token. Returns the actor resolved from the token's
   * subject. Throws `ERR_INVALID_TOKEN` on bad signature, expiry, or
   * tampering; throws `ERR_ACCOUNT_DISABLED` if the subject has been
   * disabled since the token was issued.
   */
  verifyAccessToken(token: string): Promise<{ actor: AdminAuth }>

  /**
   * Rotate the refresh token. Returns fresh tokens; the presented token
   * is revoked. Presenting an already-rotated token triggers
   * `ERR_REVOKED_TOKEN` and revokes the entire chain descended from the
   * replayed token (theft recovery).
   */
  refreshSession(args: RefreshSessionArgs): Promise<SessionTokens>

  /** Revoke a refresh token. Idempotent on an already-revoked token. */
  revokeSession(refreshToken: string): Promise<void>

  /**
   * Resolve an actor from an admin user id without any token. Used by
   * tests, seeds, and admin tooling that authenticates outside the
   * sign-in flow. Returns `null` when the user does not exist or is
   * disabled.
   */
  resolveActor(adminUserId: string): Promise<AdminAuth | null>

  /** Declarative capability flags. See `SessionProviderCapabilities`. */
  readonly capabilities: SessionProviderCapabilities
}
