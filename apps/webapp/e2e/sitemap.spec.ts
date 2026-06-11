/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { expect, test } from '@playwright/test'

test.describe('sitemap.xml', () => {
  test('serves valid XML with static and collection URLs', async ({ request }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/xml')

    const body = await response.text()
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    // Static section indexes + at least one document from each public collection.
    expect(body).toMatch(/<loc>[^<]*\/news<\/loc>/)
    expect(body).toMatch(/<loc>[^<]*\/docs<\/loc>/)
    expect(body).toMatch(/<loc>[^<]*\/docs\/[^<]+<\/loc>/)
    // hreflang alternates render for advertised-locale documents.
    expect(body).toContain('<xhtml:link rel="alternate" hreflang=')
  })
})
