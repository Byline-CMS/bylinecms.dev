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

  test('news and area pages serve markdown too — with the area guard', async ({ request }) => {
    const news = await request.get('/news/demo-news-item.md')
    expect(news.status()).toBe(200)
    expect(await news.text()).toContain('collection: "news"')

    const about = await request.get('/about/test-page.md')
    expect(about.status()).toBe(200)
    expect(await about.text()).toContain('collection: "pages"')

    // A page mounts only under its own area prefix.
    expect((await request.get('/legal/test-page.md')).status()).toBe(404)
  })

  test('the HTML head advertises the markdown alternate', async ({ request }) => {
    const response = await request.get('/docs/getting-started')
    const html = await response.text()
    expect(html).toContain('rel="alternate"')
    expect(html).toContain('type="text/markdown"')
    expect(html).toMatch(/href="[^"]*\/docs\/getting-started\.md"/)
  })

  test('Accept: text/markdown on the canonical URL negotiates to the .md variant', async ({
    request,
  }) => {
    const response = await request.get('/docs/getting-started', {
      headers: { accept: 'text/markdown' },
    })
    // Playwright follows the 302; the final response is the markdown variant.
    expect(response.status()).toBe(200)
    expect(response.url()).toContain('/docs/getting-started.md')
    expect(response.headers()['content-type']).toContain('text/markdown')
  })

  test('the HTML route is unaffected by the .md sibling', async ({ request }) => {
    const response = await request.get('/docs/getting-started')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
  })
})
