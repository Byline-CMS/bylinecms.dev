import { describe, expect, it } from 'vitest'

import { resolveRoutes } from './routes.js'

describe('resolveRoutes', () => {
  it('returns canonical defaults', () => {
    expect(resolveRoutes()).toEqual({ admin: '/admin', api: '/api', signIn: '/sign-in' })
  })

  it.each([
    ['cms', '/cms'],
    ['/cms', '/cms'],
    ['/cms/', '/cms'],
    ['///cms///', '/cms'],
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
    '/nested/cms',
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
    expect(() => resolveRoutes({ api: '/internal/api' })).toThrow(/routes\.api/)
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

  it.each(['/cms', '/cms/login', '/api/login'])('rejects conflicting sign-in path %j', (signIn) => {
    expect(() => resolveRoutes({ admin: '/cms', signIn })).toThrow(/routes\.signIn/)
  })
})
