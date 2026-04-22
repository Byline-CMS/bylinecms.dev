/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { validateCollections } from './validate-collections.js'
import type { CollectionDefinition } from '../@types/index.js'

const baseCollection: CollectionDefinition = {
  path: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
}

describe('validateCollections', () => {
  it('accepts a collection with no reserved names and no useAsPath', () => {
    expect(() => validateCollections([baseCollection])).not.toThrow()
  })

  it('rejects a top-level field named "path"', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'path', label: 'Path', type: 'text' },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/reserved system attribute/)
  })

  it('rejects a nested "path" field inside a group', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        {
          name: 'meta',
          label: 'Meta',
          type: 'group',
          fields: [{ name: 'path', label: 'Path', type: 'text' }],
        },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/reserved system attribute/)
  })

  it('rejects a "path" field nested inside a block', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        {
          name: 'content',
          label: 'Content',
          type: 'blocks',
          blocks: [
            {
              blockType: 'photoBlock',
              fields: [{ name: 'path', label: 'Path', type: 'text' }],
            },
          ],
        },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/reserved system attribute/)
  })

  it('accepts a valid useAsPath pointing at a text field', () => {
    expect(() => validateCollections([{ ...baseCollection, useAsPath: 'title' }])).not.toThrow()
  })

  it('rejects a useAsPath pointing at a missing field', () => {
    expect(() => validateCollections([{ ...baseCollection, useAsPath: 'nonexistent' }])).toThrow(
      /no top-level field with that name/
    )
  })

  it('rejects a useAsPath pointing at an unsupported field type', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'photo', label: 'Photo', type: 'image' },
      ],
      useAsPath: 'photo',
    }
    expect(() => validateCollections([collection])).toThrow(/Supported source types/)
  })

  it('accepts useAsPath pointing at a datetime field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'publishedOn', label: 'Published On', type: 'datetime', mode: 'datetime' },
      ],
      useAsPath: 'publishedOn',
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  // useAsPath deliberately resolves against top-level fields only. A
  // nested source (inside a group, array, or block) isn't addressable
  // in the derivation cascade — path is a singular identity anchor, not
  // a per-item or per-locale derivation — so the validator rejects it
  // at startup rather than silently falling through to a UUID.
  it('rejects useAsPath pointing at a field nested inside a group', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'meta',
          label: 'Meta',
          type: 'group',
          fields: [{ name: 'slugSource', label: 'Slug source', type: 'text' }],
        },
      ],
      useAsPath: 'slugSource',
    }
    expect(() => validateCollections([collection])).toThrow(/no top-level field with that name/)
  })

  it('rejects useAsPath pointing at a field nested inside an array', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'variants',
          label: 'Variants',
          type: 'array',
          fields: [{ name: 'slugSource', label: 'Slug source', type: 'text' }],
        },
      ],
      useAsPath: 'slugSource',
    }
    expect(() => validateCollections([collection])).toThrow(/no top-level field with that name/)
  })

  it('rejects useAsPath pointing at a field nested inside a block', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'content',
          label: 'Content',
          type: 'blocks',
          blocks: [
            {
              blockType: 'hero',
              fields: [{ name: 'slugSource', label: 'Slug source', type: 'text' }],
            },
          ],
        },
      ],
      useAsPath: 'slugSource',
    }
    expect(() => validateCollections([collection])).toThrow(/no top-level field with that name/)
  })
})
