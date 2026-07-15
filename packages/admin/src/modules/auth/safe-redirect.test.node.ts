import { describe, expect, it } from 'vitest'

import { normalizeRootRelativeRedirect, resolveSignInFormRedirect } from './safe-redirect.js'

describe('normalizeRootRelativeRedirect', () => {
  it.each([
    ['/cms', '/cms'],
    ['/cms/account?tab=profile#name', '/cms/account?tab=profile#name'],
  ])('accepts %j', (value, expected) => {
    expect(normalizeRootRelativeRedirect(value)).toBe(expected)
  })

  it.each([
    '',
    ' /cms',
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/cms\\account',
    '/cms\naccount',
    '%2Fcms',
    '/%2F%2Fevil.test',
    '/cms/%5cevil.test',
    '/cms/%2e/account',
  ])('rejects %j', (value) => {
    expect(normalizeRootRelativeRedirect(value)).toBeUndefined()
  })
})

describe('resolveSignInFormRedirect', () => {
  it('prefers a safe redirectTo over the deprecated callbackUrl', () => {
    expect(resolveSignInFormRedirect('/cms/account', '/cms/users', '/cms')).toBe('/cms/account')
    expect(
      resolveSignInFormRedirect('/cms/account', undefined, () => {
        throw new Error('fallback must be lazy')
      })
    ).toBe('/cms/account')
  })

  it('supports a safe deprecated callbackUrl when redirectTo is absent or unsafe', () => {
    expect(resolveSignInFormRedirect(undefined, '/cms/users', '/cms')).toBe('/cms/users')
    expect(resolveSignInFormRedirect('https://evil.test', '/cms/users', '/cms')).toBe('/cms/users')
  })

  it('uses the safe configured fallback without permitting an open redirect', () => {
    expect(resolveSignInFormRedirect('//evil.test', 'https://evil.test', '/cms')).toBe('/cms')
    expect(resolveSignInFormRedirect(undefined, undefined, 'https://evil.test')).toBe('/')
  })
})
