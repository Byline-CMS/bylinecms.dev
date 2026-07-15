import { defineClientConfig } from '@byline/core'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getAdminRouteId,
  getAdminRoutePath,
  isAdminRoutePathActive,
  isRoutePathWithin,
  resolveAdminCallbackPath,
  resolveAdminSignInRedirect,
} from './admin-path.js'

function registerRoutes(admin?: string): void {
  defineClientConfig({
    serverURL: 'http://localhost:3000',
    routes: admin ? { admin } : undefined,
    collections: [],
    admin: [],
    i18n: {
      interface: { defaultLocale: 'en', locales: [] },
      content: { defaultLocale: 'en', locales: [] },
    },
  })
}

describe('getAdminRoutePath', () => {
  beforeEach(() => registerRoutes('/cms/'))

  it.each([
    [[], '/cms'],
    [['collections'], '/cms/collections'],
    [['collections', '$collection'], '/cms/collections/$collection'],
    [['collections', '$collection', 'create'], '/cms/collections/$collection/create'],
    [['collections', '$collection', '$id'], '/cms/collections/$collection/$id'],
    [['collections', '$collection', '$id', 'history'], '/cms/collections/$collection/$id/history'],
    [['collections', '$collection', '$id', 'api'], '/cms/collections/$collection/$id/api'],
    [['users'], '/cms/users'],
    [['users', '$id'], '/cms/users/$id'],
    [['roles'], '/cms/roles'],
    [['roles', '$id'], '/cms/roles/$id'],
    [['permissions'], '/cms/permissions'],
    [['activity'], '/cms/activity'],
    [['account'], '/cms/account'],
  ])('joins %j against the configured admin mount', (segments, expected) => {
    expect(getAdminRoutePath(...segments)).toBe(expected)
  })

  it('safely joins slash-delimited segments', () => {
    expect(getAdminRoutePath('/collections/', '/pages/')).toBe('/cms/collections/pages')
    registerRoutes('cms')
    expect(getAdminRoutePath('users')).toBe('/cms/users')
  })

  it('matches dashboard, collection, and trailing-slash paths', () => {
    expect(isAdminRoutePathActive('/cms')).toBe(true)
    expect(isAdminRoutePathActive('/cms/')).toBe(true)
    expect(isAdminRoutePathActive('/cms/collections/pages', 'collections')).toBe(true)
    expect(isAdminRoutePathActive('/cms/users', 'collections')).toBe(false)
    expect(isAdminRoutePathActive('/cms/collections-old', 'collections')).toBe(false)
    expect(isRoutePathWithin('/cms/users/123', '/cms/users')).toBe(true)
    expect(isRoutePathWithin('/cms/users-archive', '/cms/users')).toBe(false)
  })

  it.each([
    ['/cms', '/cms'],
    ['/cms/', '/cms/'],
    [
      '/cms/collections/pages?query=hello%20world#results',
      '/cms/collections/pages?query=hello%20world#results',
    ],
  ])('accepts a safe admin callback %j', (callback, expected) => {
    expect(resolveAdminCallbackPath(callback)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    ' /cms',
    'https://evil.test/cms',
    '//evil.test/cms',
    '/\\evil.test/cms',
    '/admin',
    '/cms-old',
    '/cms\\users',
    '%2Fcms',
    '/%2F%2Fevil.test',
    '/cms/%2e%2e/account',
    '/cms/%2e/account',
    '/cms/%252e%252e/account',
    '/cms/%5c%5cevil.test',
  ])('rejects an unsafe or non-admin callback %j', (callback) => {
    expect(resolveAdminCallbackPath(callback)).toBeUndefined()
  })

  it('sends direct and rejected-callback sign-ins to the configured dashboard', () => {
    expect(resolveAdminSignInRedirect(undefined)).toBe('/cms')
    expect(resolveAdminSignInRedirect('https://evil.test')).toBe('/cms')
    expect(resolveAdminSignInRedirect('/cms/account')).toBe('/cms/account')
  })

  it('builds route IDs matching the custom filesystem mount', () => {
    expect(getAdminRouteId()).toBe('/_byline/cms')
    expect(getAdminRouteId('collections', '$collection', '$id', 'history')).toBe(
      '/_byline/cms/collections/$collection/$id/history'
    )
  })

  it('keeps the default admin mount backward compatible', () => {
    registerRoutes()
    expect(getAdminRoutePath()).toBe('/admin')
    expect(getAdminRoutePath('collections', '$collection')).toBe('/admin/collections/$collection')
  })
})
