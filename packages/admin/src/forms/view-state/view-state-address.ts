/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { formatInstancePath, parseInstancePath } from '@byline/core'

/**
 * Returns `path` cut before its first positional `[n]` segment, keeping
 * `[id=…]` segments. Positional addresses are not stable across reorders, so
 * only the stable prefix is trusted. Returns `''` when the first segment is
 * positional. Unparseable paths (including a leading `[n]`) are untrusted and
 * return `''`.
 */
export function trustedAddress(path: string): string {
  const parsed = parseInstancePath(path)
  if (!parsed.ok) return ''
  const cut = parsed.segments.findIndex((segment) => segment.kind === 'index')
  if (cut === -1) return path
  return formatInstancePath(parsed.segments.slice(0, cut))
}

export function isTrustedAddress(path: string): boolean {
  return path !== '' && trustedAddress(path) === path
}
