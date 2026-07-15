import { describe, expect, it } from 'vitest'

import { normalizeRootRelativeRedirect } from '../utils/root-relative-redirect.js'
import { defineClientConfig, getClientConfig } from './config.js'
import { resolveRoutes } from './routes.js'

describe('resolveRoutes', () => {
  it('returns canonical defaults', () => {
    const routes = resolveRoutes()
    expect(routes).toEqual({ admin: '/admin', api: '/api', signIn: '/sign-in' })
    expect(Object.isFrozen(routes)).toBe(true)
  })

  it.each([
    ['cms', '/cms'],
    ['/cms', '/cms'],
    ['/cms/', '/cms'],
    ['///cms///', '/cms'],
    ['/internal/cms/', '/internal/cms'],
  ])('canonicalizes an admin route of %j', (admin, expected) => {
    expect(resolveRoutes({ admin }).admin).toBe(expected)
  })

  it('falls back for empty route values', () => {
    expect(resolveRoutes({ admin: '', api: '  ', signIn: '' })).toEqual({
      admin: '/admin',
      api: '/api',
      signIn: '/sign-in',
    })
  })

  it.each([
    '/../cms',
    '/cms?next=x',
    '/cms#section',
    '/cms\\users',
    '/%63ms',
  ])('rejects a non-segment admin route of %j', (admin) => {
    expect(() => resolveRoutes({ admin })).toThrow(/routes\.admin/)
  })

  it('normalizes and validates the API route too', () => {
    expect(resolveRoutes({ api: 'content-api/' }).api).toBe('/content-api')
    expect(resolveRoutes({ api: '/internal/api' }).api).toBe('/internal/api')
  })

  it.each([
    ['staff/login', '/staff/login'],
    ['/staff/login/', '/staff/login'],
    ['/staff//login/', '/staff/login'],
  ])('canonicalizes a sign-in route of %j', (signIn, expected) => {
    expect(resolveRoutes({ signIn }).signIn).toBe(expected)
  })

  it.each([
    'https://evil.test/login',
    '//evil.test/login',
    '/staff/login?next=/cms',
    '/staff/login#form',
    '/staff\\login',
    '/staff/%6cogin',
    '/staff/../login',
  ])('rejects an unsafe sign-in route of %j', (signIn) => {
    expect(() => resolveRoutes({ signIn })).toThrow(/routes\.signIn/)
  })

  it('rejects conflicting admin and API segments', () => {
    expect(() => resolveRoutes({ admin: '/internal', api: 'internal/' })).toThrow(
      /routes\.admin and routes\.api/
    )
  })

  it.each([
    ['/internal', '/internal/api'],
    ['/internal/admin', '/internal'],
  ])('rejects overlapping admin and API trees %j and %j', (admin, api) => {
    expect(() => resolveRoutes({ admin, api })).toThrow(/routes\.admin and routes\.api/)
  })

  it.each([
    ['/cms', '/cms'],
    ['/cms', '/cms/login'],
    ['/cms', '/api/login'],
    ['/internal/cms', '/internal'],
  ])('rejects conflicting admin %j and sign-in %j paths', (admin, signIn) => {
    expect(() => resolveRoutes({ admin, signIn })).toThrow(/routes\.signIn/)
  })
})

describe('normalizeRootRelativeRedirect', () => {
  it.each([
    ['/cms', '/cms'],
    ['/cms/account?tab=profile#name', '/cms/account?tab=profile#name'],
    ['/cms/account?query=hello world', '/cms/account?query=hello%20world'],
  ])('accepts and canonicalizes %j', (value, expected) => {
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
    '/cms\u0085account',
    '/cms/../account',
    '/cms/./account',
    '/%2F%2Fevil.test',
    '/cms/%2e%2e/account',
  ])('rejects %j', (value) => {
    expect(normalizeRootRelativeRedirect(value)).toBeUndefined()
  })
})

describe('route configuration boundary', () => {
  it('stores and exposes resolved routes independently of partial input', () => {
    const input = { admin: 'internal/cms/' }
    const registered = defineClientConfig({
      serverURL: 'https://example.test',
      routes: input,
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })

    input.admin = '/changed'
    expect(registered.routes).toEqual({
      admin: '/internal/cms',
      api: '/api',
      signIn: '/sign-in',
    })
    expect(getClientConfig().routes).toBe(registered.routes)
    expect(Object.isFrozen(registered.routes)).toBe(true)
  })

  it('prevents post-registration route mutation', () => {
    const { routes } = defineClientConfig({
      serverURL: 'https://example.test',
      routes: { admin: '/internal/cms' },
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })
    expect(() => {
      ;(routes as { admin: string }).admin = '/changed'
    }).toThrow(TypeError)
    expect(getClientConfig().routes.admin).toBe('/internal/cms')
  })

  it('rejects unsafe routes during registration', () => {
    expect(() =>
      defineClientConfig({
        serverURL: 'https://example.test',
        routes: { admin: '/cms?next=/account' },
        collections: [],
        admin: [],
        i18n: {
          interface: { defaultLocale: 'en', locales: [] },
          content: { defaultLocale: 'en', locales: [] },
        },
      })
    ).toThrow(/routes\.admin/)
  })
})
