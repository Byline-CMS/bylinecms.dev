/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  PasskeyAdmissionReason,
  PasskeyOperation,
  PasskeyProvider,
  PasskeyRequestProtection,
  PasswordSignInProtection,
} from '@byline/auth'
import { AuthError, AuthErrorCodes } from '@byline/auth'

import { normalizeClientIp } from '../../integrations/client-ip.js'

/** Host boundary shared by the passkey POST handlers. Body and CSRF guards run first. */
export async function withPasskeyAdmission<T>(input: {
  provider: PasskeyProvider
  purpose: PasskeyOperation
  request: Request
  bodyChecked: boolean
  protection: PasskeyRequestProtection | undefined
  /** Required only for password proof; lookup must authenticate the expected login. */
  password?: {
    protection: PasswordSignInProtection | undefined
    resolveActorEmail(): Promise<string>
  }
  work(metadata: { ip: string }): Promise<T>
}): Promise<T> {
  const recordDenial = (reason: PasskeyAdmissionReason) => {
    try {
      void Promise.resolve(input.provider.recordAdmissionDenied?.(input.purpose, reason)).catch(
        () => {}
      )
    } catch {
      /* Observability cannot change admission or strand capacity. */
    }
  }
  const denied = (reason: PasskeyAdmissionReason, status: number, retry?: number): never => {
    recordDenial(reason)
    throw new Response(
      status === 429
        ? 'Too many authentication requests'
        : 'Authentication temporarily unavailable',
      {
        status,
        headers: {
          'Cache-Control': 'no-store',
          ...(retry ? { 'Retry-After': String(retry) } : {}),
        },
      }
    )
  }
  const available = async <R>(work: () => Promise<R>): Promise<R> => {
    try {
      return await work()
    } catch {
      return denied('unavailable', 503)
    }
  }
  const protection = input.protection
  if (!input.bodyChecked || !protection) return denied('unavailable', 503)
  const ip = await available(async () =>
    normalizeClientIp(await protection.resolveClientIp(input.request))
  )
  if (!ip) return denied('unavailable', 503)
  const release = await available(() => protection.limiter.acquire())
  if (!release) return denied('capacity', 429, 1)
  try {
    const admission = await available(() => protection.limiter.consume({ ip }))
    if (!admission.allowed) return denied('network', 429, admission.retryAfterSeconds)
    if (input.purpose === 'password-proof' && !input.password) return denied('unavailable', 503)
    if (!input.password) return await input.work({ ip })
    const password = input.password
    const passwordProtection = password.protection
    if (!passwordProtection) return denied('unavailable', 503)
    // Resolve the account from the authenticated expected login, never from submitted email.
    let email: string
    try {
      email = await password.resolveActorEmail()
    } catch (error) {
      recordDenial('unavailable')
      throw error
    }
    const passwordIp = await available(async () =>
      normalizeClientIp(await passwordProtection.resolveClientIp(input.request))
    )
    if (!passwordIp) return denied('unavailable', 503)
    const releasePassword = await available(() => passwordProtection.limiter.acquire())
    if (!releasePassword) return denied('capacity', 429, 1)
    try {
      const passwordAdmission = await available(() =>
        passwordProtection.limiter.consume({ email, ip: passwordIp })
      )
      if (!passwordAdmission.allowed)
        return denied('network', 429, passwordAdmission.retryAfterSeconds)
      const record = (outcome: 'success' | 'failure') => {
        try {
          void Promise.resolve(
            passwordProtection.limiter.recordResult?.({ email, ip: passwordIp }, outcome)
          ).catch(() => {})
        } catch {
          /* Best effort. */
        }
      }
      try {
        const result = await input.work({ ip })
        record('success')
        return result
      } catch (error) {
        if (error instanceof AuthError && error.code === AuthErrorCodes.INVALID_CREDENTIALS)
          record('failure')
        throw error
      }
    } finally {
      releasePassword()
    }
  } finally {
    release()
  }
}
