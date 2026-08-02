import { defineClientConfig } from '@byline/core'
import { beforeEach, describe, expect, it } from 'vitest'

import { getSignInRoutePath } from './sign-in-path.js'

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
})
