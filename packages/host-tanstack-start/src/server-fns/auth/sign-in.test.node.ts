/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {} as any,
  request: null as unknown as Request,
  signIn: vi.fn(),
  limiter: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  outcome: vi.fn(),
  setCookies: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (validate: (input: unknown) => unknown) => ({
      handler: (handler: any) => ({ validate, handler }),
    }),
  }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => mocks.request,
  getRequestHeader: () => undefined,
}))
vi.mock('@byline/core', () => ({ getServerConfig: () => mocks.config }))
vi.mock('@byline/client/server', () => ({ setSessionCookies: mocks.setCookies }))
vi.mock('../../i18n/locale-cookie.js', () => ({ readAdminLocaleCookie: () => null }))
vi.mock('../../integrations/byline-core.js', () => ({
  bylineCore: () => {
    throw new Error('unused')
  },
}))

import { checkSignInBody } from '../../integrations/sign-in-body.js'
import { adminSignIn } from './sign-in.js'

const fn = adminSignIn as unknown as {
  validate: (input: unknown) => unknown
  handler: (args: any) => Promise<unknown>
}
const input = { email: 'admin@example.test', password: 'legacy' }
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.request = new Request('http://localhost/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  await checkSignInBody(mocks.request)
  mocks.acquire.mockResolvedValue(mocks.release)
  mocks.limiter.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  mocks.signIn.mockResolvedValue({ actor: { id: 'test' } })
  mocks.config = {
    sessionProvider: { signInWithPassword: mocks.signIn },
    passwordSignIn: {
      resolveClientIp: () => '192.0.2.1',
      limiter: { consume: mocks.limiter, acquire: mocks.acquire, recordResult: mocks.outcome },
    },
  }
})
describe('password sign-in protection', () => {
  it('admits validated legacy credentials and sets cookies after authentication', async () => {
    expect(await fn.handler({ data: fn.validate(input) })).toEqual({ userId: 'test' })
    expect(mocks.limiter).toHaveBeenCalledWith({ email: input.email, ip: '192.0.2.1' })
    expect(mocks.signIn).toHaveBeenCalledWith({ ...input, ip: '192.0.2.1', userAgent: undefined })
    expect(mocks.setCookies).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized credentials during validation', () => {
    expect(() => fn.validate({ ...input, password: 'a'.repeat(129) })).toThrow()
    expect(mocks.signIn).not.toHaveBeenCalled()
  })
  it('returns 429 with Retry-After before the provider is called', async () => {
    mocks.limiter.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 })
    const error = await fn.handler({ data: input }).catch((e) => e)
    expect(error.status).toBe(429)
    expect(error.headers.get('Retry-After')).toBe('42')
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.setCookies).not.toHaveBeenCalled()
  })
  it('sheds capacity before accessing the store or provider', async () => {
    mocks.acquire.mockResolvedValue(null)
    expect((await fn.handler({ data: input }).catch((e) => e)).status).toBe(429)
    expect(mocks.limiter).not.toHaveBeenCalled()
    expect(mocks.signIn).not.toHaveBeenCalled()
  })
  it('releases capacity and records failed verification', async () => {
    mocks.signIn.mockRejectedValueOnce(new Error('invalid credentials'))
    await expect(fn.handler({ data: input })).rejects.toThrow('invalid credentials')
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(mocks.outcome).toHaveBeenCalledWith({ email: input.email, ip: '192.0.2.1' }, 'failure')
  })
  it.each(['store', 'ip', 'middleware', 'config'])(
    'fails closed when %s protection is unavailable',
    async (kind) => {
      if (kind === 'store') mocks.limiter.mockRejectedValue(new Error('DB unavailable'))
      if (kind === 'ip') mocks.config.passwordSignIn.resolveClientIp = () => null
      if (kind === 'middleware') mocks.request = new Request('http://localhost/sign-in')
      if (kind === 'config') delete mocks.config.passwordSignIn
      expect((await fn.handler({ data: input }).catch((e) => e)).status).toBe(503)
      expect(mocks.signIn).not.toHaveBeenCalled()
    }
  )
})
