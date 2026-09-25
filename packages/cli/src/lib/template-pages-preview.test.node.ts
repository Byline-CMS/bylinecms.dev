/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Runtime test of the scaffolded Pages preview builder (the file generated
 * projects receive). The prefix must follow the content default locale, never
 * the admin interface default, and the selected content locale must survive
 * even when it is not advertised.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

// Admin and content defaults deliberately differ.
vi.mock('~/i18n', () => ({
  i18n: {
    admin: { defaultLocale: 'en', locales: ['en', 'fr'] },
    content: { defaultLocale: 'fr', locales: ['fr', 'en', 'es'] },
  },
}))

// The admin config is data plus React components; only `preview.url` matters.
vi.mock('@byline/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  defineAdmin: (_definition: unknown, config: unknown) => config,
}))
vi.mock('@byline/admin/react', () => ({ DateTimeFormatter: () => null }))
vi.mock('~/components/summary-length.js', () => ({ SummaryLength: () => null }))

interface PreviewDoc {
  id: string
  path: string
  status: string
  fields: Record<string, unknown>
}
type PreviewUrl = (doc: PreviewDoc, ctx: { locale?: string }) => string | null

// `src/templates` is excluded from the CLI's TypeScript program; a runtime-only
// specifier keeps the compiler from following the import (see the docs hooks test).
const templateAdminPath = '../templates/byline-examples/collections/pages/admin.js'
let url: PreviewUrl

beforeAll(async () => {
  const module = await import(/* @vite-ignore */ templateAdminPath)
  const preview = (module.PagesAdmin as { preview?: { url: PreviewUrl } }).preview
  if (preview == null) throw new Error('template Pages admin has no preview builder')
  url = preview.url
})

function page(path: string, area?: string): PreviewDoc {
  return { id: 'doc-1', path, status: 'draft', fields: area ? { area } : {} }
}

describe('scaffolded Pages preview URL', () => {
  it('omits the prefix for the content default locale, even though admin defaults to en', () => {
    expect(url(page('team'), { locale: 'fr' })).toBe('/team')
  })

  it('prefixes every other content locale, including the admin default', () => {
    expect(url(page('team'), { locale: 'en' })).toBe('/en/team')
    expect(url(page('team'), { locale: 'es' })).toBe('/es/team')
  })

  it('hides the affordance until the page has a path', () => {
    expect(url(page(''), { locale: 'es' })).toBeNull()
  })
})
