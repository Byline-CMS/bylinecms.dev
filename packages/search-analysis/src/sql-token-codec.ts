/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'

import type { LogicalToken, LogicalTokenKind } from './types.js'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

const KIND_PREFIX: Readonly<Record<LogicalTokenKind, string>> = {
  exact: 'ex',
  stem: 'st',
  lemma: 'le',
  normalized: 'no',
  identifier: 'id',
  gram: 'gr',
}

export interface SqlTokenCodecOptions {
  /**
   * Maximum physical term length before a SHA-256 representation is used.
   * The default stays well below common SQL full-text parser limits.
   */
  maxLength?: number
}

/**
 * Encode a logical token as lowercase ASCII alphanumeric text. Kind prefixes
 * prevent exact/stem/gram collisions and ensure even one-character source
 * terms exceed MySQL's default minimum token length.
 */
export function encodeSqlToken(
  token: Pick<LogicalToken, 'kind' | 'value'>,
  options: SqlTokenCodecOptions = {}
): string {
  if (token.value.length === 0) throw new TypeError('Cannot encode an empty search token')

  const prefix = KIND_PREFIX[token.kind]
  const encoded = `${prefix}${base32(new TextEncoder().encode(token.value))}`
  const maxLength = options.maxLength ?? 80
  if (!Number.isSafeInteger(maxLength) || maxLength < 16) {
    throw new RangeError('SQL token maxLength must be a safe integer of at least 16')
  }
  if (encoded.length <= maxLength) return encoded

  const digest = createHash('sha256').update(token.value, 'utf8').digest()
  return `${prefix}h${base32(digest)}`.slice(0, maxLength)
}

export function encodeSqlTokens(
  tokens: readonly Pick<LogicalToken, 'kind' | 'value'>[],
  options: SqlTokenCodecOptions = {}
): string[] {
  return tokens.map((token) => encodeSqlToken(token, options))
}

function base32(bytes: Uint8Array): string {
  let value = 0
  let bits = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}
