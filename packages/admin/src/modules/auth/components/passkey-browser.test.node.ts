import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  PasskeyAdminServices,
  PasskeyPageBinding,
} from '../../../services/admin-services-types.js'

const browser = vi.hoisted(() => ({
  supported: vi.fn(),
  authentication: vi.fn(),
  registration: vi.fn(),
}))
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: browser.supported,
  startAuthentication: browser.authentication,
  startRegistration: browser.registration,
}))

import {
  enrollPasskey,
  passkeyErrorKey,
  provePasskeyAction,
  signInWithPasskey,
} from './passkey-browser.js'

let services: PasskeyAdminServices
let binding: PasskeyPageBinding
const expiresAt = () => new Date(Date.now() + 60_000).toISOString()
beforeEach(() => {
  vi.resetAllMocks()
  browser.supported.mockReturnValue(true)
  browser.authentication.mockResolvedValue({ id: 'assertion' })
  browser.registration.mockResolvedValue({ id: 'attestation' })
  binding = { expectedSessionId: 'login-A', assertCurrent: vi.fn() }
  const ceremony = () => ({ ceremonyId: 'attempt', expiresAt: expiresAt(), options: {} })
  const grant = () => ({ grantId: 'grant', expiresAt: expiresAt() })
  services = {
    capability: vi.fn(),
    captureLogin: vi.fn(() => binding),
    managementContext: vi.fn(),
    signInOptions: vi.fn(async () => ceremony()),
    signIn: vi.fn(),
    passwordProof: vi.fn(async () => grant()),
    proofOptions: vi.fn(async () => ceremony()),
    proof: vi.fn(async () => grant()),
    enrollmentOptions: vi.fn(async () => ceremony()),
    enrollment: vi.fn(),
    list: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  } as unknown as PasskeyAdminServices
})
describe('browser passkey ceremonies', () => {
  it('does not enter the cookie-changing submission until the prompt finishes', async () => {
    let finish!: (value: unknown) => void
    browser.authentication.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = signInWithPasskey(services)
    await vi.waitFor(() => expect(browser.authentication).toHaveBeenCalledOnce())
    expect(services.signIn).not.toHaveBeenCalled()
    finish({ id: 'verified' })
    await pending
    expect(services.signIn).toHaveBeenCalledWith(
      { data: { ceremonyId: 'attempt', response: { id: 'verified' } } },
      expect.objectContaining({ expectedSessionId: 'login-A' })
    )
  })
  it.each(['AbortError', 'NotAllowedError'])(
    'cancellation %s does not submit or retry',
    async (name) => {
      browser.authentication.mockRejectedValue(Object.assign(new Error('cancelled'), { name }))
      await expect(signInWithPasskey(services)).rejects.toThrow('cancelled')
      expect(services.signInOptions).toHaveBeenCalledOnce()
      expect(services.signIn).not.toHaveBeenCalled()
    }
  )
  it('rejects a login switch during the authenticator prompt', async () => {
    browser.authentication.mockImplementation(async () => {
      vi.mocked(binding.assertCurrent).mockImplementation(() => {
        throw new Error('session changed')
      })
      return { id: 'other-account' }
    })
    await expect(signInWithPasskey(services)).rejects.toThrow('session changed')
    expect(services.signIn).not.toHaveBeenCalled()
  })
  it('abandons a completed prompt when the sign-in page has unmounted', async () => {
    let active = true
    browser.authentication.mockImplementation(async () => {
      active = false
      return {}
    })
    await expect(signInWithPasskey(services, () => active)).rejects.toThrow('page closed')
    expect(services.signIn).not.toHaveBeenCalled()
  })
  it('does not open a device prompt for an expired challenge', async () => {
    vi.mocked(services.signInOptions).mockResolvedValue({
      ceremonyId: 'expired',
      expiresAt: new Date(0).toISOString(),
      options: {} as any,
    })
    await expect(signInWithPasskey(services)).rejects.toMatchObject({ code: 'ERR_INVALID_TOKEN' })
    expect(browser.authentication).not.toHaveBeenCalled()
  })
  it('binds password proof and enrollment to the page login, without email input', async () => {
    await enrollPasskey(services, binding, 'Laptop', 'password')
    expect(services.passwordProof).toHaveBeenCalledWith({
      data: { expectedSessionId: 'login-A', action: { purpose: 'enroll' }, password: 'password' },
    })
    expect(services.enrollmentOptions).toHaveBeenCalledWith({
      data: { expectedSessionId: 'login-A', grantId: 'grant' },
    })
    expect(services.enrollment).toHaveBeenCalledWith({
      data: {
        expectedSessionId: 'login-A',
        ceremonyId: 'attempt',
        response: { id: 'attestation' },
        name: 'Laptop',
      },
    })
  })
  it('does not enroll after a login change during registration', async () => {
    browser.registration.mockImplementation(async () => {
      vi.mocked(binding.assertCurrent).mockImplementation(() => {
        throw new Error('session changed')
      })
      return { id: 'attestation' }
    })
    await expect(enrollPasskey(services, binding, 'Laptop', 'password')).rejects.toThrow(
      'session changed'
    )
    expect(services.enrollment).not.toHaveBeenCalled()
  })
  it('passes a scoped removal action and never accepts a wrong-account proof', async () => {
    const action = {
      purpose: 'remove' as const,
      targetUserId: 'target',
      credentialRecordId: 'record',
    }
    vi.mocked(services.proof).mockRejectedValue(
      Object.assign(new Error('wrong account'), { code: 'ERR_INVALID_CREDENTIALS' })
    )
    await expect(provePasskeyAction(services, binding, action)).rejects.toThrow('wrong account')
    expect(services.proofOptions).toHaveBeenCalledWith({
      data: { expectedSessionId: 'login-A', action },
    })
    expect(services.remove).not.toHaveBeenCalled()
    expect(services.proof).toHaveBeenCalledOnce()
  })
  it('does not retry ambiguous enrollment completion', async () => {
    vi.mocked(services.enrollment).mockRejectedValue(new Error('connection lost'))
    await expect(enrollPasskey(services, binding, 'Laptop', 'password')).rejects.toThrow(
      'connection lost'
    )
    expect(services.enrollment).toHaveBeenCalledOnce()
    expect(services.enrollmentOptions).toHaveBeenCalledOnce()
  })
  it('keeps password proof available without WebAuthn support', async () => {
    browser.supported.mockReturnValue(false)
    await expect(
      provePasskeyAction(
        services,
        binding,
        { purpose: 'remove', targetUserId: 'target', credentialRecordId: 'key' },
        'password'
      )
    ).resolves.toMatchObject({ grantId: 'grant' })
    await expect(signInWithPasskey(services)).rejects.toMatchObject({ code: 'PASSKEY_UNSUPPORTED' })
  })
  it.each([
    [{ code: 'ERR_INVALID_TOKEN' }, 'expired'],
    [{ code: 'ERR_SESSION_CHANGED' }, 'sessionChanged'],
    [{ code: 'ERR_INVALID_CREDENTIALS' }, 'proof'],
    [{ code: 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT' }, 'unsupported'],
    [{ code: 'ERROR_AUTHENTICATOR_GENERAL_ERROR' }, 'device'],
    [
      { code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: { name: 'NotAllowedError' } },
      'cancelled',
    ],
    [{ status: 429 }, 'rateLimited'],
  ])('maps bounded public error %j to usable copy', (error, key) => {
    expect(passkeyErrorKey(error)).toBe(`passkeys.errors.${key}`)
  })
})
