import { defineClientConfig } from '@byline/core'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  configureSignInRoutePath,
  createSignInRoutePathResolver,
  getSignInRoutePath,
} from './sign-in-path.js'

describe('sign-in route configuration', () => {
  beforeEach(() => {
    defineClientConfig({
      serverURL: 'http://localhost:3000',
      routes: { signIn: '/staff/login/' },
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })
  })

  it('reads and normalizes routes.signIn', () => {
    expect(getSignInRoutePath()).toBe('/staff/login')
  })

  it('allows a deprecated signInPath override when it matches canonical config', () => {
    expect(configureSignInRoutePath('staff/login/')).toBe('/staff/login')
  })

  it('rejects an invalid or divergent deprecated override when resolved', () => {
    expect(() => configureSignInRoutePath('/auth/login/')).toThrow(/must match routes\.signIn/)
    expect(() => configureSignInRoutePath('/auth/../login')).toThrow(/routes\.signIn/)
  })

  it('validates an override against configured rather than default route trees', () => {
    defineClientConfig({
      serverURL: 'http://localhost:3000',
      routes: { admin: '/cms', api: '/rpc', signIn: '/admin/login' },
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })

    expect(configureSignInRoutePath('/admin/login/')).toBe('/admin/login')
    expect(() => configureSignInRoutePath('/cms/login')).toThrow(/routes\.signIn/)
  })

  it('defers a deprecated override until parent beforeLoad config registration', () => {
    defineClientConfig({
      serverURL: 'http://localhost:3000',
      routes: { signIn: '/old/login' },
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })
    const resolveSignInPath = createSignInRoutePathResolver('/staff/login/')

    defineClientConfig({
      serverURL: 'http://localhost:3000',
      routes: { signIn: '/staff/login' },
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })

    expect(resolveSignInPath()).toBe('/staff/login')
  })
})
