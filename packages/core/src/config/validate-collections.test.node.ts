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

  it('accepts useAsPath pointing at a counter field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'serialNumber', label: 'Serial Number', type: 'counter', group: 'serials' },
      ],
      useAsPath: 'serialNumber',
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('accepts useAsPath pointing at an integer field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'issue', label: 'Issue', type: 'integer' },
      ],
      useAsPath: 'issue',
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

  it('rejects a top-level field named "availableLocales"', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'availableLocales', label: 'Available Locales', type: 'text' },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/reserved system attribute/)
  })

  it('points the user at advertiseLocales when "availableLocales" is declared as a field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'availableLocales', label: 'Available Locales', type: 'text' },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/advertiseLocales: true/)
  })

  it('rejects a nested "availableLocales" field inside a group', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        {
          name: 'meta',
          label: 'Meta',
          type: 'group',
          fields: [{ name: 'availableLocales', label: 'Available Locales', type: 'text' }],
        },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/reserved system attribute/)
  })

  it('accepts advertiseLocales: true when the collection has a localized field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [{ name: 'title', label: 'Title', type: 'text', localized: true }],
      advertiseLocales: true,
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('accepts advertiseLocales: true with a nested localized field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'meta',
          label: 'Meta',
          type: 'group',
          fields: [{ name: 'summary', label: 'Summary', type: 'textArea', localized: true }],
        },
      ],
      advertiseLocales: true,
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('rejects advertiseLocales: true when the collection has no localized fields', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [{ name: 'title', label: 'Title', type: 'text' }],
      advertiseLocales: true,
    }
    expect(() => validateCollections([collection])).toThrow(/no localized fields/)
  })

  it('accepts advertiseLocales omitted regardless of localized fields', () => {
    expect(() => validateCollections([baseCollection])).not.toThrow()
  })

  it('accepts tree: true on its own', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      useAsTitle: 'title',
      useAsPath: 'title',
      tree: true,
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('rejects tree: true together with orderable: true', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      tree: true,
      orderable: true,
    }
    expect(() => validateCollections([collection])).toThrow(/tree: true.*orderable: true|orderable/)
  })

  it('accepts orderable: true without tree', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      orderable: true,
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // Virtual fields
  // -------------------------------------------------------------------------

  it('accepts an optional virtual field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'regenerate',
          label: 'Regenerate',
          type: 'checkbox',
          virtual: true,
          optional: true,
        },
      ],
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('accepts a virtual field with a defaultValue', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'page', label: 'Page', type: 'integer', virtual: true, defaultValue: 1 },
      ],
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('rejects a required virtual field with no defaultValue', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'regenerate', label: 'Regenerate', type: 'checkbox', virtual: true },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(
      /virtual field "regenerate".*optional.*defaultValue/s
    )
  })

  it('rejects a required virtual field nested in an array group — error names the full path', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'files',
          label: 'Files',
          type: 'array',
          fields: [
            {
              name: 'filesGroup',
              type: 'group',
              fields: [
                { name: 'generateThumbnail', label: 'Generate', type: 'checkbox', virtual: true },
              ],
            },
          ],
        },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/files\.filesGroup\.generateThumbnail/)
  })

  it('rejects a virtual counter field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'serial',
          label: 'Serial',
          type: 'counter',
          group: 'serials',
          virtual: true,
          optional: true,
        },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/virtual counter field/)
  })

  it('rejects a virtual upload-capable file field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        {
          name: 'attachment',
          label: 'Attachment',
          type: 'file',
          virtual: true,
          optional: true,
          upload: { mimeTypes: ['application/pdf'] },
        },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/virtual upload field/)
  })

  it('accepts a virtual file field WITHOUT an upload block', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'scratchFile', label: 'Scratch', type: 'file', virtual: true, optional: true },
      ],
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })

  it('rejects useAsTitle pointing at a virtual field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      useAsTitle: 'ephemeral',
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'ephemeral', label: 'Ephemeral', type: 'text', virtual: true, optional: true },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/useAsTitle.*virtual/s)
  })

  it('rejects useAsPath pointing at a virtual field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      useAsPath: 'ephemeral',
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'ephemeral', label: 'Ephemeral', type: 'text', virtual: true, optional: true },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/useAsPath.*virtual/s)
  })

  it('rejects a search body entry referencing a virtual field', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      search: { body: ['title', 'ephemeral'] },
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'ephemeral', label: 'Ephemeral', type: 'text', virtual: true, optional: true },
      ],
    }
    expect(() => validateCollections([collection])).toThrow(/search/)
  })

  it('accepts a virtual field that search does not reference', () => {
    const collection: CollectionDefinition = {
      ...baseCollection,
      search: { body: ['title'] },
      fields: [
        { name: 'title', label: 'Title', type: 'text' },
        { name: 'ephemeral', label: 'Ephemeral', type: 'text', virtual: true, optional: true },
      ],
    }
    expect(() => validateCollections([collection])).not.toThrow()
  })
})
