/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** Maximum accepted password length, shared by enrollment and sign-in. */
export const MAX_PASSWORD_LENGTH = 128
export const MAX_SIGN_IN_EMAIL_LENGTH = 254

/** Fixed-window admission result. Denied attempts must not reach password hashing. */
export interface SignInAdmission {
  allowed: boolean
  retryAfterSeconds: number
}

export interface PasswordSignInLimiter {
  /** When present, core boot requires this task in recurringTasks. TTL-backed limiters may omit it. */
  readonly requiredCleanupTask?: string
  /** Acquire process-local capacity before any counter access; null means shed with 429. */
  acquire(): Promise<(() => void) | null>
  recordResult?(input: { email: string; ip: string }, outcome: 'success' | 'failure'): void
  consume(input: { email: string; ip: string }): Promise<SignInAdmission>
}

/** Host-owned trust boundary. Return null when a trustworthy address is unavailable. */
export type ClientIpResolver = (request: Request) => string | null | Promise<string | null>

export interface PasswordSignInProtection {
  limiter: PasswordSignInLimiter
  resolveClientIp: ClientIpResolver
}
