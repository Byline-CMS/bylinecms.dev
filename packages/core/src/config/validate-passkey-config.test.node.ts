import type { PasskeyProvider, SessionProvider } from '@byline/auth'
import { describe, expect, it } from 'vitest'

import { testAdapter } from '../storage/db-adapter.test-helper.js'
import { resolveServerConfig } from './config.js'
import { resolvePasskeyConfig } from './validate-passkey-config.js'
import type { PasskeyConfig } from '../@types/site-config.js'

const unused = async (): Promise<never> => {
  throw new Error('Configuration validation must not execute provider operations')
}
const passwordOnly = {
  capabilities: { passwordChange: true, magicLink: false, sso: false },
  signInWithPassword: unused,
  verifyAccessToken: unused,
  refreshSession: unused,
  revokeSession: unused,
  resolveActor: unused,
} satisfies SessionProvider
const ceremonies = {
  signInOptions: unused,
  verifySignIn: unused,
  passwordProof: unused,
  proofOptions: unused,
  verifyProof: unused,
  enrollmentOptions: unused,
  verifyEnrollment: unused,
  listCredentials: unused,
  renameCredential: unused,
  removeCredential: unused,
} satisfies PasskeyProvider
const enabled = {
  ...passwordOnly,
  capabilities: { ...passwordOnly.capabilities, passkeys: true },
  passkeys: ceremonies,
} satisfies SessionProvider
const config: PasskeyConfig = {
  rpId: 'example.com',
  rpName: 'Byline',
  origins: ['https://example.com', 'https://edit.example.com:8443'],
}

describe('optional passkey configuration', () => {
  it('keeps existing password-only and absent providers working', () => {
    expect(resolvePasskeyConfig(undefined, passwordOnly)).toBeUndefined()
    expect(resolvePasskeyConfig(undefined, undefined)).toBeUndefined()
    expect(
      resolvePasskeyConfig(undefined, {
        ...passwordOnly,
        capabilities: { ...passwordOnly.capabilities, passkeys: false },
      })
    ).toBeUndefined()
  })

  it('validates and snapshots explicitly configured trust without invoking a ceremony', () => {
    const origins = [...config.origins]
    const resolved = resolvePasskeyConfig({ ...config, origins }, enabled)!
    origins.push('https://evil.example.com')
    expect(resolved.origins).toEqual(config.origins)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.origins)).toBe(true)
  })

  it('runs validation through server configuration resolution', () => {
    expect(() =>
      resolveServerConfig({
        collections: [],
        db: testAdapter({}),
        i18n: {
          admin: { defaultLocale: 'en', locales: [] },
          content: { defaultLocale: 'en', locales: [] },
        },
        sessionProvider: passwordOnly,
        passkeys: config,
      })
    ).toThrow('provider does not support passkeys')
  })

  it('requires configuration and capability to agree', () => {
    expect(() => resolvePasskeyConfig(undefined, enabled)).toThrow('explicit relying-party')
    expect(() => resolvePasskeyConfig(config, passwordOnly)).toThrow('does not support')
    expect(() => resolvePasskeyConfig(config, undefined)).toThrow('does not support')
    expect(() => resolvePasskeyConfig(config, { ...enabled, passkeys: undefined })).toThrow(
      'does not support'
    )
    expect(() =>
      resolvePasskeyConfig(undefined, { ...passwordOnly, passkeys: ceremonies })
    ).toThrow('explicit relying-party')
  })

  it.each(Object.keys(ceremonies))('rejects a provider missing %s', (method) => {
    const partial = { ...ceremonies, [method]: undefined } as unknown as PasskeyProvider
    expect(() => resolvePasskeyConfig(config, { ...enabled, passkeys: partial })).toThrow(
      `missing ${method}`
    )
  })

  it.each([
    '',
    'example.com:443',
    'https://example.com',
    '*.example.com',
    'EXAMPLE.COM',
    'example.com.',
    '127.0.0.1',
    '[::1]',
    'com',
  ])('rejects invalid RP ID %s', (rpId) => {
    expect(() => resolvePasskeyConfig({ ...config, rpId }, enabled)).toThrow('rpId')
  })

  it.each([
    'http://example.com',
    'https://example.com/',
    'https://example.com/path',
    'https://example.com?x=1',
    'https://example.com#fragment',
    'https://user@example.com',
    'https://EXAMPLE.COM',
    'https://example.com:443',
    'https://evil-example.com',
    'https://example.com.evil.com',
    'https://other.com',
    'null',
    '*',
  ])('rejects an unsafe or noncanonical origin %s', (origin) => {
    expect(() => resolvePasskeyConfig({ ...config, origins: [origin] }, enabled)).toThrow(
      'Invalid passkey'
    )
  })

  it('permits HTTP only for explicitly enabled localhost development', () => {
    const local = { rpId: 'localhost', rpName: 'Local', origins: ['http://localhost:5173'] }
    expect(() => resolvePasskeyConfig(local, enabled)).toThrow('HTTPS')
    expect(
      resolvePasskeyConfig({ ...local, allowInsecureLocalhost: true }, enabled)?.origins
    ).toEqual(local.origins)
    expect(() =>
      resolvePasskeyConfig(
        { ...config, origins: ['http://example.com'], allowInsecureLocalhost: true },
        enabled
      )
    ).toThrow('HTTPS')
    expect(() =>
      resolvePasskeyConfig(
        { ...local, origins: ['http://foo.localhost'], allowInsecureLocalhost: true },
        enabled
      )
    ).toThrow('HTTPS')
  })

  it.each([
    { rpName: '' },
    { rpName: '   ' },
    { rpName: 'x'.repeat(201) },
    { origins: [] },
    { origins: ['https://example.com', 'https://example.com'] },
    { origins: [42] },
    { allowInsecureLocalhost: 'true' },
    { relatedOrigins: true },
  ])('rejects malformed or unsupported configuration %j', (invalid) => {
    expect(() =>
      resolvePasskeyConfig({ ...config, ...invalid } as unknown as PasskeyConfig, enabled)
    ).toThrow('Invalid passkey')
  })
})
