/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { expect, test } from '@playwright/test'

test.describe('markdown export — /docs/{path}.md', () => {
  test('serves frontmatter + body for a published doc', async ({ request }) => {
    const response = await request.get('/docs/getting-started.md')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/markdown')

    const body = await response.text()
    expect(body).toMatch(/^---\n/)
    expect(body).toContain('title: "')
    expect(body).toContain('collection: "docs"')
    expect(body).toContain('locale: "en"')
    expect(body).toContain('canonical: "')
    expect(body).toContain('# ')
  })

  test('serves a per-content-locale variant under the locale prefix', async ({ request }) => {
    const response = await request.get('/fr/docs/getting-started.md')
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('locale: "fr"')
  })

  test('404s for a missing document and an unroutable locale', async ({ request }) => {
    expect((await request.get('/docs/no-such-doc.md')).status()).toBe(404)
    expect((await request.get('/xx/docs/getting-started.md')).status()).toBe(404)
  })

  test('the HTML route is unaffected by the .md sibling', async ({ request }) => {
    const response = await request.get('/docs/getting-started')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
  })
})
