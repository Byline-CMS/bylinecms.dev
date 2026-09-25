/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Preview URL builders for the reference collections. The Preview button
 * passes the content locale selected in the editor, and the builder must keep
 * it (preview is how an editor reviews a translation that is not advertised)
 * under the public routing rule, not the admin interface language.
 */

import type { CollectionAdminConfig, PreviewDocument } from '@byline/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

function doc(path: string, fields: Record<string, unknown> = {}): PreviewDocument {
  return { id: 'doc-1', path, status: 'draft', fields }
}

async function loadAdmins() {
  const [{ DocsAdmin }, { NewsAdmin }, { PagesAdmin }] = await Promise.all([
    import('./docs/admin.js'),
    import('./news/admin.js'),
    import('./pages/admin.js'),
  ])
  return { DocsAdmin, NewsAdmin, PagesAdmin }
}

function previewUrl(admin: CollectionAdminConfig, d: PreviewDocument, locale?: string) {
  const url = admin.preview?.url
  if (url == null) throw new Error(`${admin.slug ?? 'collection'} has no preview builder`)
  return url(d, { locale })
}

describe('reference preview URL builders', () => {
  afterEach(() => {
    vi.doUnmock('@/i18n/i18n-config')
    vi.resetModules()
  })

  it('keeps the selected content locale as the route prefix', async () => {
    const { DocsAdmin, NewsAdmin, PagesAdmin } = await loadAdmins()

    expect(previewUrl(DocsAdmin, doc('cli'), 'es')).toBe('/es/docs/cli')
    expect(previewUrl(NewsAdmin, doc('launch'), 'es')).toBe('/es/news/launch')
    expect(previewUrl(PagesAdmin, doc('team', { area: 'about' }), 'es')).toBe('/es/about/team')
    expect(previewUrl(PagesAdmin, doc('contact', { area: 'root' }), 'es')).toBe('/es/contact')
  })

  it('omits the prefix for the public default locale and when no locale is selected', async () => {
    const { DocsAdmin, NewsAdmin, PagesAdmin } = await loadAdmins()

    expect(previewUrl(DocsAdmin, doc('cli'), 'en')).toBe('/docs/cli')
    expect(previewUrl(NewsAdmin, doc('launch'), undefined)).toBe('/news/launch')
    expect(previewUrl(PagesAdmin, doc('team', { area: 'about' }), 'en')).toBe('/about/team')
  })

  it('hides the affordance until the document has a path', async () => {
    const { DocsAdmin, NewsAdmin, PagesAdmin } = await loadAdmins()

    expect(previewUrl(DocsAdmin, doc(''), 'es')).toBeNull()
    expect(previewUrl(NewsAdmin, doc(''), 'es')).toBeNull()
    expect(previewUrl(PagesAdmin, doc(''), 'es')).toBeNull()
  })

  it('follows the public routing default, not the admin interface default', async () => {
    // A site whose public routing default is French while the admin default
    // stays English. English content must now carry a prefix and French none.
    vi.resetModules()
    vi.doMock('@/i18n/i18n-config', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/i18n/i18n-config')>()
      return { ...actual, i18nConfig: { ...actual.i18nConfig, defaultLocale: 'fr' } }
    })
    const { i18n } = await import('~/i18n')
    expect(i18n.admin.defaultLocale).toBe('en')

    const { DocsAdmin, NewsAdmin, PagesAdmin } = await loadAdmins()

    expect(previewUrl(PagesAdmin, doc('team', { area: 'about' }), 'en')).toBe('/en/about/team')
    expect(previewUrl(PagesAdmin, doc('team', { area: 'about' }), 'fr')).toBe('/about/team')
    expect(previewUrl(DocsAdmin, doc('cli'), 'en')).toBe('/en/docs/cli')
    expect(previewUrl(NewsAdmin, doc('launch'), 'fr')).toBe('/news/launch')
  })
})
