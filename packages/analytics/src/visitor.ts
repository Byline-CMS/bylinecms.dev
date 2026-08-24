/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHmac } from 'node:crypto'

/** Length-prefix both UTF-8 components so no pair can share an ambiguous encoding. */
export function canonicalVisitorIdentity(clientIp: string, userAgent: string): Uint8Array {
  const ip = Buffer.from(clientIp, 'utf8')
  const ua = Buffer.from(userAgent, 'utf8')
  const output = Buffer.allocUnsafe(8 + ip.length + ua.length)
  output.writeUInt32BE(ip.length, 0)
  ip.copy(output, 4)
  output.writeUInt32BE(ua.length, 4 + ip.length)
  ua.copy(output, 8 + ip.length)
  return output
}

export function hashAnalyticsVisitor(
  dailySalt: Uint8Array,
  clientIp: string,
  userAgent: string
): string {
  return createHmac('sha256', dailySalt)
    .update(canonicalVisitorIdentity(clientIp, userAgent))
    .digest('hex')
}
