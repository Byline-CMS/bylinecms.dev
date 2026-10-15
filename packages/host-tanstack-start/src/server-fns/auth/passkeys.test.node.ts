import { AdminAuth, ERR_SESSION_CHANGED } from '@byline/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {} as any,
  request: null as unknown as Request,
  auth: vi.fn(),
  user: vi.fn(),
  setCookies: vi.fn(),
  clearCookies: vi.fn(),
  clearPreview: vi.fn(),
  header: vi.fn(),
  release: vi.fn(),
  consume: vi.fn(),
  acquire: vi.fn(),
  passwordConsume: vi.fn(),
  passwordRelease: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const result: any = {
      middleware: () => result,
      validator: (validate: any) => {
        result.validate = validate
        return result
      },
      handler: (handler: any) => {
        result.handler = handler
        return result
      },
    }
    return result
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => mocks.request,
  getRequestHeader: () => undefined,
  setResponseHeader: mocks.header,
}))
vi.mock('@byline/core', () => ({ getServerConfig: () => mocks.config }))
vi.mock('@byline/client/server', () => ({
  getAdminRequestContext: mocks.auth,
  readAccessTokenCookie: () => 'server-access',
  readRefreshTokenCookie: () => 'server-refresh',
  setSessionCookies: mocks.setCookies,
  clearSessionCookies: mocks.clearCookies,
  clearPreviewCookie: mocks.clearPreview,
}))
vi.mock('../../integrations/session-middleware.js', () => ({
  adminSessionMiddleware: {},
  adminSessionMutationMiddleware: {},
}))
vi.mock('../../integrations/byline-core.js', () => ({
  bylineCore: () => ({ adminStore: { adminUsers: { getById: mocks.user } } }),
}))
vi.mock('../../i18n/locale-cookie.js', () => ({ readAdminLocaleCookie: () => null }))

import { checkPasskeyBody } from '../../integrations/sign-in-body.js'
import * as endpoints from './passkeys.js'

const sid = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000002'
const bearer = 'a'.repeat(43)
const methods = [
  'signInOptions',
  'verifySignIn',
  'passwordProof',
  'proofOptions',
  'verifyProof',
  'enrollmentOptions',
  'verifyEnrollment',
  'listCredentials',
  'renameCredential',
  'removeCredential',
]
let provider: Record<string, ReturnType<typeof vi.fn>>
const invoke = (endpoint: unknown, data: unknown = {}) => {
  const fn = endpoint as {
    validate?: (data: unknown) => unknown
    handler: (args: any) => Promise<any>
  }
  return fn.handler({ data: fn.validate ? fn.validate(data) : data })
}
async function request(password = false) {
  mocks.request = new Request('https://app.test/passkeys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  await checkPasskeyBody(mocks.request, password)
}
beforeEach(async () => {
  vi.resetAllMocks()
  provider = Object.fromEntries(methods.map((name) => [name, vi.fn().mockResolvedValue({})]))
  mocks.auth.mockResolvedValue({
    actor: new AdminAuth({ id: userId, abilities: [] }),
    sessionId: sid,
  })
  mocks.user.mockResolvedValue({ id: userId, email: 'actor@example.test' })
  mocks.acquire.mockResolvedValue(mocks.release)
  mocks.consume.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  mocks.passwordConsume.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  mocks.config = {
    passkeys: {},
    sessionProvider: { capabilities: { passkeys: true }, passkeys: provider },
    passkeyRequests: {
      resolveClientIp: () => '192.0.2.1',
      limiter: { acquire: mocks.acquire, consume: mocks.consume },
    },
    passwordSignIn: {
      resolveClientIp: () => '192.0.2.1',
      limiter: { acquire: async () => mocks.passwordRelease, consume: mocks.passwordConsume },
    },
  }
  await request()
})
describe('passkey host endpoints', () => {
  it('discovers only an enabled capability without starting a ceremony', async () => {
    expect(await invoke(endpoints.getPasskeyCapability)).toEqual({ enabled: true })
    delete mocks.config.passkeys
    expect(await invoke(endpoints.getPasskeyCapability)).toEqual({ enabled: false })
    expect(provider.signInOptions).not.toHaveBeenCalled()
  })
  it('keeps tokens server-side and writes cookies only after verified issuance', async () => {
    const result = {
      actor: { id: userId },
      sessionId: sid,
      accessToken: 'secret',
      refreshToken: 'secret',
    }
    provider.verifySignIn.mockResolvedValue(result)
    const response = { raw: 'untrusted' }
    expect(await invoke(endpoints.passkeySignIn, { ceremonyId: bearer, response })).toEqual({
      userId,
      sessionId: sid,
    })
    expect(provider.verifySignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        previousAccessToken: 'server-access',
        previousRefreshToken: 'server-refresh',
        response,
      })
    )
    expect(mocks.setCookies).toHaveBeenCalledWith(result)
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'no-store')
    provider.verifySignIn.mockRejectedValue(new Error('uncertain commit'))
    await expect(invoke(endpoints.passkeySignIn, { ceremonyId: bearer, response })).rejects.toThrow(
      'uncertain commit'
    )
    expect(mocks.setCookies).toHaveBeenCalledTimes(1)
  })
  it.each([undefined, false, true, 'false'])(
    'forwards crossOrigin %s without rewriting signed response bytes',
    async (crossOrigin) => {
      const response = {
        response: {
          clientDataJSON: Buffer.from(JSON.stringify({ crossOrigin })).toString('base64url'),
        },
      }
      await invoke(endpoints.passkeyProof, { expectedSessionId: sid, ceremonyId: bearer, response })
      expect(provider.verifyProof.mock.calls[0][0].response).toBe(response)
    }
  )
  it('applies both limiters with server-resolved email for password proof', async () => {
    await request(true)
    await invoke(endpoints.passkeyPasswordProof, {
      expectedSessionId: sid,
      password: 'legacy',
      action: { purpose: 'enroll' },
    })
    expect(mocks.passwordConsume).toHaveBeenCalledWith({
      email: 'actor@example.test',
      ip: '192.0.2.1',
    })
    expect(mocks.consume).toHaveBeenCalledOnce()
    expect(mocks.passwordRelease).toHaveBeenCalledOnce()
    expect(provider.passwordProof).toHaveBeenCalledWith({
      expectedSessionId: sid,
      accessToken: 'server-access',
      password: 'legacy',
      action: { purpose: 'enroll' },
    })
  })
  it('rejects a substituted expected login before proof or password lookup', async () => {
    await request(true)
    await expect(
      invoke(endpoints.passkeyPasswordProof, {
        expectedSessionId: userId,
        password: 'legacy',
        action: { purpose: 'enroll' },
      })
    ).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
    expect(mocks.user).not.toHaveBeenCalled()
    expect(provider.passwordProof).not.toHaveBeenCalled()
  })
  it('does not let a client supply an email or access credential', () => {
    expect(() =>
      invoke(endpoints.passkeyPasswordProof, {
        expectedSessionId: sid,
        password: 'legacy',
        action: { purpose: 'enroll' },
        email: 'other@example.test',
      })
    ).toThrow()
    expect(() =>
      invoke(endpoints.passkeyList, { expectedSessionId: sid, accessToken: 'client-token' })
    ).toThrow()
  })
  it.each([false, true])(
    'clears cookies only when removal signs out the actor: %s',
    async (signedOut) => {
      provider.removeCredential.mockResolvedValue({ signedOut })
      expect(
        await invoke(endpoints.passkeyRemove, { expectedSessionId: sid, grantId: bearer })
      ).toEqual({ signedOut })
      expect(mocks.clearCookies).toHaveBeenCalledTimes(signedOut ? 1 : 0)
      expect(mocks.clearPreview).toHaveBeenCalledTimes(signedOut ? 1 : 0)
    }
  )
  it('does not clear cookies or retry an ambiguous removal', async () => {
    provider.removeCredential.mockRejectedValue(new Error('connection lost'))
    await expect(
      invoke(endpoints.passkeyRemove, { expectedSessionId: sid, grantId: bearer })
    ).rejects.toThrow('connection lost')
    expect(provider.removeCredential).toHaveBeenCalledOnce()
    expect(mocks.clearCookies).not.toHaveBeenCalled()
  })
  it.each(['middleware', 'protection', 'capability', 'capacity'])(
    'fails closed before provider work without %s',
    async (failure) => {
      if (failure === 'middleware') mocks.request = new Request('https://app.test')
      if (failure === 'protection') delete mocks.config.passkeyRequests
      if (failure === 'capability') mocks.config.sessionProvider.capabilities.passkeys = false
      if (failure === 'capacity') mocks.acquire.mockResolvedValue(null)
      const error = await invoke(endpoints.passkeySignInOptions).catch((error) => error)
      expect(error.status).toBe(failure === 'capability' ? 404 : failure === 'capacity' ? 429 : 503)
      expect(provider.signInOptions).not.toHaveBeenCalled()
    }
  )
  it('never retries provider session-change errors', async () => {
    provider.verifyProof.mockRejectedValue(ERR_SESSION_CHANGED({ message: 'authority changed' }))
    await expect(
      invoke(endpoints.passkeyProof, { expectedSessionId: sid, ceremonyId: bearer, response: {} })
    ).rejects.toMatchObject({ code: 'ERR_SESSION_CHANGED' })
    expect(provider.verifyProof).toHaveBeenCalledOnce()
  })
})
