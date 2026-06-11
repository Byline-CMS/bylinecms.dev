/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { expect, test } from '@playwright/test'

test.describe('llms.txt', () => {
  test('serves the agent index with sections of .md links', async ({ request }) => {
    const response = await request.get('/llms.txt')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/plain')

    const body = await response.text()
    expect(body).toMatch(/^# /)
    expect(body).toContain('\n> ')
    expect(body).toContain('## Documentation')
    expect(body).toMatch(/- \[[^\]]+\]\([^)]+\/docs\/[^)]+\.md\)/)
  })
})
