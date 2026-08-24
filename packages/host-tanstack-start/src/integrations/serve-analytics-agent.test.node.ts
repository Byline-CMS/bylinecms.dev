/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { serveAnalyticsAgent } from './serve-analytics-agent.js'

describe('serveAnalyticsAgent', () => {
  it('serves the bundled standalone collector with bounded first-party caching', async () => {
    const response = serveAnalyticsAgent()
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600, must-revalidate')
    expect(await response.text()).toContain('text/plain')
  })
})
