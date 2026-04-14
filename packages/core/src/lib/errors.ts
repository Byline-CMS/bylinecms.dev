/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Structured error handling for Byline CMS.
 *
 * Follows the Modulus CoreError pattern: every error carries a machine-readable
 * `code`, optional `details` (included in API responses), and optional `logExtra`
 * (included only in logs). The `.log(logger)` method logs the error exactly once
 * and then sets the log level to 'silent' to prevent double-logging up the stack.
 *
 * Errors are created via factory functions produced by `createErrorType()`:
 *
 *   throw ERR_NOT_FOUND({
 *     message: 'document not found',
 *     details: { documentId },
 *   }).log(logger)
 */

import type { BylineLogger, LogLevel, LogLevelWithSilent } from './logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorReport = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type BylineErrorOptions = {
  /** Short description of the error, for internal consumption. */
  message: string
  /** Optional underlying cause (e.g. a 3rd-party error). */
  cause?: unknown
  /** Details to be included in the error report (API responses) AND logs. */
  details?: Record<string, unknown>
  /** If true, stack trace will be captured. */
  captureStack?: boolean
  /** Log level for this error. Defaults to 'error'. */
  logLevel?: LogLevelWithSilent
  /** Extra data to include only in logs (never in API responses). */
  logExtra?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// BylineError base class
// ---------------------------------------------------------------------------

export class BylineError extends Error {
  /** Machine-readable error code (e.g. 'ERR_NOT_FOUND'). */
  readonly code: string

  /** Additional details included in both error reports and logs. */
  readonly details?: Record<string, unknown>

  /** Extra values included only when logging this error. */
  readonly logExtra?: Record<string, unknown>

  /**
   * Level at which this error should be logged when caught. Will always be
   * 'silent' after `.log()` has been called.
   */
  private logLevel: LogLevelWithSilent

  constructor(code: string, options: BylineErrorOptions, errorConstructor?: any) {
    const { message, cause, details, captureStack = false, logLevel = 'error', logExtra } = options

    // If Error.captureStackTrace is available, skip the default stack trace
    // generation (which would happen during the call to super()), and then
    // explicitly capture a stack trace _if_ captureStack is true _and_
    // logLevel is not 'silent'.
    if ('captureStackTrace' in Error) {
      const { stackTraceLimit } = Error
      Error.stackTraceLimit = 0
      super(message, { cause })
      Error.stackTraceLimit = stackTraceLimit
      if (captureStack && logLevel !== 'silent') {
        Error.captureStackTrace(this, errorConstructor ?? this.constructor)
      }
    } else {
      super(message, { cause })
    }

    this.code = code
    this.details = details
    this.logExtra = logExtra
    this.logLevel = logLevel

    // Mark these properties as non-enumerable so Pino doesn't serialize them
    // as part of the error object itself.
    Object.defineProperties(this, {
      details: { enumerable: false },
      logLevel: { enumerable: false },
      logExtra: { enumerable: false },
    })
  }

  /**
   * Log this error via the given logger. Sets `logLevel` to 'silent' after
   * the first call to prevent double-logging when the error is re-thrown.
   *
   * Returns `this` for chaining: `throw ERR_X({ ... }).log(logger)`
   */
  log(logger: BylineLogger): typeof this {
    if (this.logLevel !== 'silent') {
      logger.log(this.logLevel, { err: this, ...this.details, ...this.logExtra })
      this.logLevel = 'silent'
    }
    return this
  }

  /**
   * Serialize this error for API responses. Includes `code`, `message`,
   * and `details` but deliberately excludes `logExtra`.
   */
  report(): ErrorReport {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a reusable error factory for a given error code and default log level.
 *
 * ```ts
 * export const ERR_NOT_FOUND = createErrorType('ERR_NOT_FOUND', 'warn')
 *
 * throw ERR_NOT_FOUND({ message: 'document not found' }).log(logger)
 * ```
 */
export const createErrorType = (code: string, logLevel: LogLevel = 'error') => {
  const cons = (opts: BylineErrorOptions, errorConstructor?: any) =>
    new BylineError(code, { logLevel, ...opts }, errorConstructor ?? cons)
  return cons
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  UNHANDLED: 'ERR_UNHANDLED',
  NOT_FOUND: 'ERR_NOT_FOUND',
  CONFLICT: 'ERR_CONFLICT',
  VALIDATION: 'ERR_VALIDATION',
  INVALID_TRANSITION: 'ERR_INVALID_TRANSITION',
  PATCH_FAILED: 'ERR_PATCH_FAILED',
  DATABASE: 'ERR_DATABASE',
  STORAGE: 'ERR_STORAGE',
  READ_BUDGET_EXCEEDED: 'ERR_READ_BUDGET_EXCEEDED',
} as const

// ---------------------------------------------------------------------------
// Pre-instantiated factories
// ---------------------------------------------------------------------------

export const ERR_UNHANDLED = createErrorType(ErrorCodes.UNHANDLED)
export const ERR_NOT_FOUND = createErrorType(ErrorCodes.NOT_FOUND, 'warn')
export const ERR_CONFLICT = createErrorType(ErrorCodes.CONFLICT, 'warn')
export const ERR_VALIDATION = createErrorType(ErrorCodes.VALIDATION, 'warn')
export const ERR_INVALID_TRANSITION = createErrorType(ErrorCodes.INVALID_TRANSITION, 'warn')
export const ERR_PATCH_FAILED = createErrorType(ErrorCodes.PATCH_FAILED)
export const ERR_DATABASE = createErrorType(ErrorCodes.DATABASE)
export const ERR_STORAGE = createErrorType(ErrorCodes.STORAGE)
export const ERR_READ_BUDGET_EXCEEDED = createErrorType(ErrorCodes.READ_BUDGET_EXCEEDED)
