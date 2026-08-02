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
    '/cms/../account',
    '/cms/./account',
    '/cms\u0085account',
  ])('rejects %j', (value) => {
    expect(normalizeRootRelativeRedirect(value)).toBeUndefined()
  })
})

describe('resolveSignInFormRedirect', () => {
  it('uses a safe redirectTo without evaluating the fallback', () => {
    expect(resolveSignInFormRedirect('/cms/account', '/cms')).toBe('/cms/account')
    expect(
      resolveSignInFormRedirect('/cms/account', () => {
        throw new Error('fallback must be lazy')
      })
    ).toBe('/cms/account')
  })

  it('uses the safe configured fallback without permitting an open redirect', () => {
    expect(resolveSignInFormRedirect('//evil.test', '/cms')).toBe('/cms')
    expect(resolveSignInFormRedirect(undefined, 'https://evil.test')).toBe('/')
  })
})
