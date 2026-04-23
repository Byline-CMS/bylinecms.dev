/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Auth-realm error factories.
 *
 * Shaped to match `@byline/core`'s `BylineError` / `createErrorType` conventions
 * (a `code` property and a factory that returns a thrown-ready error) without
 * depending on core — `@byline/auth` stays a leaf package so that core can
 * import types from it without circular risk.
 *
 * Consumers can:
 *   - `instanceof AuthError` to narrow,
 *   - `err.code === 'ERR_FORBIDDEN'` to branch on category,
 *   - catch and re-throw as a `BylineError` at the service boundary if the
 *     logger integration is wanted (Phase 4 call sites will do this).
 */

export const AuthErrorCodes = {
  UNAUTHENTICATED: 'ERR_UNAUTHENTICATED',
  FORBIDDEN: 'ERR_FORBIDDEN',
  INVALID_CREDENTIALS: 'ERR_INVALID_CREDENTIALS',
  INVALID_TOKEN: 'ERR_INVALID_TOKEN',
  REVOKED_TOKEN: 'ERR_REVOKED_TOKEN',
  ACCOUNT_DISABLED: 'ERR_ACCOUNT_DISABLED',
} as const

export type AuthErrorCode = (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes]

export interface AuthErrorOptions {
  message: string
  cause?: unknown
}

export class AuthError extends Error {
  public readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, options: AuthErrorOptions) {
    super(options.message, options.cause != null ? { cause: options.cause } : undefined)
    this.name = 'AuthError'
    this.code = code
  }
}

const createAuthErrorType = (code: AuthErrorCode) => {
  return (options: AuthErrorOptions) => new AuthError(code, options)
}

/** Throw when a request has no actor and the path requires one. */
export const ERR_UNAUTHENTICATED = createAuthErrorType(AuthErrorCodes.UNAUTHENTICATED)

/** Throw when the actor is known but lacks the required ability. */
export const ERR_FORBIDDEN = createAuthErrorType(AuthErrorCodes.FORBIDDEN)

/**
 * Throw on sign-in when the email/password combination does not match a
 * known account. Message is intentionally generic — callers should not
 * distinguish "unknown email" from "wrong password" at this layer.
 */
export const ERR_INVALID_CREDENTIALS = createAuthErrorType(AuthErrorCodes.INVALID_CREDENTIALS)

/**
 * Throw when an access or refresh token is malformed, has a bad signature,
 * has expired, or otherwise cannot be verified.
 */
export const ERR_INVALID_TOKEN = createAuthErrorType(AuthErrorCodes.INVALID_TOKEN)

/**
 * Throw when a refresh token has been revoked — either explicitly, or
 * because it was rotated and the caller is presenting a stale copy
 * (replay). Presenting a rotated token additionally revokes the entire
 * chain descended from it.
 */
export const ERR_REVOKED_TOKEN = createAuthErrorType(AuthErrorCodes.REVOKED_TOKEN)

/**
 * Throw when credentials / token are valid but the account has been
 * disabled (`is_enabled = false`).
 */
export const ERR_ACCOUNT_DISABLED = createAuthErrorType(AuthErrorCodes.ACCOUNT_DISABLED)
