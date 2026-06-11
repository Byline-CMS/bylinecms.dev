/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { negotiateMarkdownRedirect } from './markdown-negotiation'

function request(path: string, accept?: string, method = 'GET'): Request {
  return new Request(`https://example.com${path}`, {
    method,
    headers: accept != null ? { accept } : undefined,
  })
}

describe('negotiateMarkdownRedirect', () => {
  it('redirects an explicit text/markdown request to the .md sibling', () => {
    const response = negotiateMarkdownRedirect(request('/docs/getting-started', 'text/markdown'))
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('https://example.com/docs/getting-started.md')
    expect(response?.headers.get('vary')).toBe('Accept')
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('preserves the locale prefix', () => {
    const response = negotiateMarkdownRedirect(request('/fr/news/foo', 'text/markdown'))
    expect(response?.headers.get('location')).toBe('https://example.com/fr/news/foo.md')
  })

  it('never diverts a browser (Accept leads with text/html)', () => {
    expect(
      negotiateMarkdownRedirect(
        request('/docs/getting-started', 'text/html,application/xhtml+xml,text/markdown;q=0.9')
      )
    ).toBeNull()
  })

  it('ignores requests without text/markdown, non-GETs, and .md URLs', () => {
    expect(negotiateMarkdownRedirect(request('/docs/x', '*/*'))).toBeNull()
    expect(negotiateMarkdownRedirect(request('/docs/x'))).toBeNull()
    expect(negotiateMarkdownRedirect(request('/docs/x', 'text/markdown', 'POST'))).toBeNull()
    expect(negotiateMarkdownRedirect(request('/docs/x.md', 'text/markdown'))).toBeNull()
  })

  it('leaves the home page, admin surface, and assets alone', () => {
    expect(negotiateMarkdownRedirect(request('/', 'text/markdown'))).toBeNull()
    expect(negotiateMarkdownRedirect(request('/admin/collections', 'text/markdown'))).toBeNull()
    expect(negotiateMarkdownRedirect(request('/favicon.ico', 'text/markdown'))).toBeNull()
  })
})
