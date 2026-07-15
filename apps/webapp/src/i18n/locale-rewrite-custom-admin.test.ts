import { describe, expect, it, vi } from 'vitest'

vi.mock('~/public', () => ({
  contentLocales: [],
  routes: { admin: '/cms', api: '/api', signIn: '/staff/login' },
}))

import { isLocalizablePath, localeInputRewrite, localeOutputRewrite } from './locale-rewrite'

function input(pathname: string): string {
  return localeInputRewrite(new URL(pathname, 'https://example.test')).pathname
}

function output(pathname: string): string {
  return localeOutputRewrite(new URL(pathname, 'https://example.test')).pathname
}

describe('locale rewrite with a custom admin mount', () => {
  it('keeps the configured admin tree locale-less', () => {
    expect(input('/cms')).toBe('/cms')
    expect(input('/cms/collections/pages')).toBe('/cms/collections/pages')
    expect(isLocalizablePath('/cms/users')).toBe(false)
  })

  it('does not retain the default mount as a runtime assumption', () => {
    expect(input('/admin')).toBe('/en/admin')
    expect(isLocalizablePath('/admin')).toBe(true)
  })

  it('keeps the configured nested sign-in route locale-less in both directions', () => {
    expect(input('/staff/login')).toBe('/staff/login')
    expect(input('/staff/login/reset')).toBe('/staff/login/reset')
    expect(output('/staff/login')).toBe('/staff/login')
    expect(isLocalizablePath('/staff/login')).toBe(false)
    expect(isLocalizablePath('/staff/profile')).toBe(true)
  })
})
