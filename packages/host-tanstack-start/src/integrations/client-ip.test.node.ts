/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { createClientIpResolver, normalizeClientIp } from './client-ip.js'

describe('client IP trust boundary', () => {
  it('ignores spoofed forwarding headers in direct mode', async () => {
    const resolve = createClientIpResolver({ resolvePeerIp: () => '192.0.2.1' })
    expect(
      await resolve(
        new Request('https://app.test', {
          headers: { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' },
        })
      )
    ).toBe('192.0.2.1')
  })
  it('uses only the configured proxy header and fails closed on absent/invalid values', async () => {
    const resolve = createClientIpResolver({
      trustedProxyHeader: 'x-byline-client-ip',
      resolvePeerIp: () => '127.0.0.1',
    })
    for (const value of ['', '192.0.2.1, 192.0.2.2', 'garbage']) {
      expect(
        await resolve(new Request('https://app.test', { headers: { 'x-byline-client-ip': value } }))
      ).toBeNull()
    }
    expect(
      await resolve(
        new Request('https://app.test', { headers: { 'x-byline-client-ip': '2001:0db8::1' } })
      )
    ).toBe('2001:db8::1')
  })
  it('normalizes equivalent IP representations', () => {
    expect(normalizeClientIp('::ffff:192.0.2.1')).toBe('192.0.2.1')
    expect(normalizeClientIp('::ffff:c000:201')).toBe('192.0.2.1')
    expect(normalizeClientIp('fe80::1%en0')).toBeNull()
  })
})
