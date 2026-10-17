/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createRequire } from 'node:module'

import { type FieldSet, flattenFieldSetData, restoreFieldSetData } from '@byline/core'
import { KeyvCacheableMemory } from 'cacheable'
import { Keyv } from 'keyv'
import { expect, it } from 'vitest'

// Exercise the serializer actually installed with the host transport.
const hostRequire = createRequire(import.meta.resolve('@tanstack/react-start/package.json'))
const { toJSON, fromJSON } = hostRequire('seroval')

it('preserves compacted content and reports across JSON, transport, and the configured memory cache', async () => {
  const live = { blockType: 'live', fields: [{ name: 'text', type: 'text' as const }] }
  const before: FieldSet = [
    { name: 'content', type: 'blocks', blocks: [live, { ...live, blockType: 'retired' }] },
  ]
  const after: FieldSet = [{ name: 'content', type: 'blocks', blocks: [live] }]
  const rows = flattenFieldSetData(
    before,
    {
      content: [
        { _type: 'retired', text: 'gone' },
        { _type: 'live', text: 'keep' },
        { _type: 'retired', text: 'gone' },
        { _type: 'live', text: 'last' },
      ],
    },
    'en'
  )
  const restored = restoreFieldSetData(after, rows, 'en')
  const cache = new Keyv({ store: new KeyvCacheableMemory({ ttl: 60_000, lruSize: 10 }) })
  try {
    await cache.set('document', restored)
    expect(await cache.get('document')).toEqual(restored)
    expect(JSON.parse(JSON.stringify(restored))).toEqual(restored)
    expect(fromJSON(toJSON(restored))).toEqual(restored)
  } finally {
    await cache.disconnect()
  }
})
