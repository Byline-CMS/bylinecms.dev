/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  PasskeyProvider,
  PasskeyRequestProtection,
  PasswordSignInProtection,
} from '@byline/auth'
import { AuthError, AuthErrorCodes } from '@byline/auth'
import { describe, expect, it, vi } from 'vitest'

import { withPasskeyAdmission } from './passkey-admission.js'

function fixture() {
  const release = vi.fn()
  const denial = vi.fn()
  const work = vi.fn(async () => 'done')
  const protection: PasskeyRequestProtection = {
    resolveClientIp: vi.fn(async () => '192.0.2.1'),
    limiter: {
      acquire: vi.fn(async () => release),
      consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    },
  }
  const provider = { recordAdmissionDenied: denial } as unknown as PasskeyProvider
  const input = {
    provider,
    purpose: 'sign-in' as const,
    request: new Request('https://cms.example.test'),
    bodyChecked: true,
    protection,
    work,
  }
  return { input, release, denial, work, protection }
}

describe('passkey host admission', () => {
  it.each(['middleware', 'protection', 'address', 'capacity', 'counter'] as const)(
    'fails closed before provider work for %s',
    async (failure) => {
      const f = fixture()
      if (failure === 'middleware') f.input.bodyChecked = false
      if (failure === 'protection')
        f.input.protection = undefined as unknown as PasskeyRequestProtection
      if (failure === 'address') vi.mocked(f.protection.resolveClientIp).mockResolvedValue(null)
      if (failure === 'capacity') vi.mocked(f.protection.limiter.acquire).mockResolvedValue(null)
      if (failure === 'counter')
        vi.mocked(f.protection.limiter.consume).mockRejectedValue(new Error('storage secret'))
      await expect(withPasskeyAdmission(f.input)).rejects.toMatchObject({
        status: failure === 'capacity' ? 429 : 503,
      })
      expect(f.work).not.toHaveBeenCalled()
      expect(f.denial).toHaveBeenCalledTimes(1)
      expect(f.release).toHaveBeenCalledTimes(failure === 'counter' ? 1 : 0)
    }
  )
  it('denies network saturation and releases capacity despite a throwing telemetry hook', async () => {
    const f = fixture()
    vi.mocked(f.protection.limiter.consume).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 17,
    })
    f.denial.mockImplementation(() => {
      throw new Error('hook failure')
    })
    const error = await withPasskeyAdmission(f.input).catch((error: Response) => error)
    expect(error).toBeInstanceOf(Response)
    expect((error as Response).headers.get('Retry-After')).toBe('17')
    expect((error as Response).headers.get('Cache-Control')).toBe('no-store')
    expect(f.work).not.toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('does not double-count provider failures as admission denials', async () => {
    const f = fixture()
    f.work.mockRejectedValue(new Error('verification failed'))
    await expect(withPasskeyAdmission(f.input)).rejects.toThrow('verification failed')
    expect(f.denial).not.toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('runs the full password limiter using server-resolved account email and releases both leases', async () => {
    const f = fixture()
    const releasePassword = vi.fn()
    const passwordProtection: PasswordSignInProtection = {
      resolveClientIp: vi.fn(async () => '192.0.2.1'),
      limiter: {
        acquire: vi.fn(async () => releasePassword),
        consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
        recordResult: vi.fn(() => {
          throw new Error('hook failure')
        }),
      },
    }
    const resolveActorEmail = vi.fn(async () => 'server-resolved@example.test')
    const input = {
      ...f.input,
      purpose: 'password-proof' as const,
      password: { protection: passwordProtection, resolveActorEmail },
    }
    await expect(withPasskeyAdmission(input)).resolves.toBe('done')
    expect(passwordProtection.limiter.consume).toHaveBeenCalledWith({
      email: 'server-resolved@example.test',
      ip: '192.0.2.1',
    })
    expect(passwordProtection.limiter.recordResult).toHaveBeenCalledWith(
      { email: 'server-resolved@example.test', ip: '192.0.2.1' },
      'success'
    )
    expect(f.protection.limiter.acquire).toHaveBeenCalledBefore(resolveActorEmail)
    expect(passwordProtection.limiter.acquire).toHaveBeenCalledBefore(
      passwordProtection.limiter.consume
    )
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(releasePassword).toHaveBeenCalledTimes(1)
    expect(f.denial).not.toHaveBeenCalled()
    vi.mocked(passwordProtection.limiter.consume).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 4,
    })
    await expect(withPasskeyAdmission(input)).rejects.toMatchObject({ status: 429 })
    expect(f.work).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledTimes(2)
    expect(releasePassword).toHaveBeenCalledTimes(2)
    expect(f.denial).toHaveBeenCalledExactlyOnceWith('password-proof', 'network')
  })
  it.each([
    AuthErrorCodes.INVALID_CREDENTIALS,
    AuthErrorCodes.FORBIDDEN,
    AuthErrorCodes.SESSION_CHANGED,
    AuthErrorCodes.PASSKEY_LIMIT,
    AuthErrorCodes.PASSKEY_UNAVAILABLE,
  ])('accounts for password-proof errors accurately: %s', async (code) => {
    const f = fixture()
    const releasePassword = vi.fn()
    const recordResult = vi.fn()
    f.work.mockRejectedValue(new AuthError(code, { message: 'Rejected' }))
    const passwordProtection: PasswordSignInProtection = {
      resolveClientIp: async () => '192.0.2.1',
      limiter: {
        acquire: async () => releasePassword,
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
        recordResult,
      },
    }
    await expect(
      withPasskeyAdmission({
        ...f.input,
        purpose: 'password-proof',
        password: {
          protection: passwordProtection,
          resolveActorEmail: async () => 'server@example.test',
        },
      })
    ).rejects.toMatchObject({ code })
    expect(recordResult).toHaveBeenCalledTimes(code === AuthErrorCodes.INVALID_CREDENTIALS ? 1 : 0)
    expect(f.denial).not.toHaveBeenCalled()
    expect(releasePassword).toHaveBeenCalledTimes(1)
    expect(f.release).toHaveBeenCalledTimes(1)
  })

  it('cannot use password proof without the full password protection', async () => {
    const f = fixture()
    await expect(
      withPasskeyAdmission({ ...f.input, purpose: 'password-proof' })
    ).rejects.toMatchObject({ status: 503 })
    expect(f.work).not.toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledTimes(1)
  })
})
