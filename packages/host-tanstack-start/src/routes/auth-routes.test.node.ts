import { defineClientConfig } from '@byline/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { resolveAdminCallbackPath, resolveAdminSignInRedirect } from './admin-path.js'
import { configureSignInRoutePath, getSignInRoutePath } from './sign-in-path.js'

describe('admin authentication routes', () => {
  beforeEach(() => {
    defineClientConfig({
      serverURL: 'http://localhost:3000',
      routes: { admin: '/cms/', signIn: '/staff/login/' },
      collections: [],
      admin: [],
      i18n: {
        interface: { defaultLocale: 'en', locales: [] },
        content: { defaultLocale: 'en', locales: [] },
      },
    })
  })

  it('sanitizes sign-in route search before it reaches the form', () => {
    expect(resolveAdminCallbackPath('/cms/account')).toBe('/cms/account')
    expect(resolveAdminCallbackPath('https://evil.test')).toBeUndefined()
  })

  it('uses the custom mount for direct sign-in and callback navigation', () => {
    expect(resolveAdminSignInRedirect(undefined)).toBe('/cms')
    expect(resolveAdminSignInRedirect('/cms/collections/pages/1')).toBe('/cms/collections/pages/1')
  })

  it('shares routes.signIn between guard and sign-out consumers', () => {
    expect(getSignInRoutePath()).toBe('/staff/login')
    expect(configureSignInRoutePath('/staff/login/')).toBe('/staff/login')
  })

  it('does not allow the deprecated layout override to silently diverge', () => {
    expect(() => configureSignInRoutePath('/auth/login')).toThrow(/must match routes\.signIn/)
  })
})
