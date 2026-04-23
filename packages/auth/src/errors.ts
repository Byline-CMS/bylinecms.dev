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
