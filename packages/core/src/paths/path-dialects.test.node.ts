/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { prepareHookAttachment } from '../config/attach-hooks.js'
import {
  validateAdminConfigs,
  validateBlockAdminConfigs,
} from '../config/validate-admin-configs.js'
import { validateCollections } from '../config/validate-collections.js'
import { parsePatchPath } from '../patches/apply-patches.js'
import type { CollectionAdminConfig, CollectionDefinition } from '../@types/index.js'

// ---------------------------------------------------------------------------
// Characterization tests for Byline's field-path notations.
//
// Several subsystems address fields by dotted path, and they do NOT all use
// the same grammar. This file pins the CURRENT behaviour of each so that the
// reconciliation work (see PATH-GRAMMAR-ANALYSIS-AND-RECONCILIATION.md) either
// preserves it or changes it visibly and on purpose.
//
// The organising model — the two categories these dialects fall into:
//
//   * INSTANCE paths address a value in one item of one document. Indices are
//     required. The block type is redundant: the item carries its own `_type`.
//   * DECLARATION paths address a field declaration in the schema. There are
//     no indices. The block type IS required — without it, two blocks in the
//     same field that declare the same field name are indistinguishable.
//
// Some assertions below pin behaviour that is known to be WRONG. Those are
// marked `KNOWN DEFECT` and cite the fix that will change them. A failure
// there is expected progress; a failure anywhere else is a regression.
// ---------------------------------------------------------------------------

/**
 * One fixture, exercising every structural combination the dialects differ
 * over: array→group nesting, a blocks field, an array inside a block, an
 * upload field inside a block, and — critically — two block types that each
 * declare a field named `alt`, which is what makes an unqualified path
 * ambiguous.
 */
const fixture = (overrides: { altVirtual?: boolean } = {}): CollectionDefinition =>
  ({
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    useAsTitle: 'title',
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
              { name: 'publicationFile', label: 'File', type: 'file', upload: {} },
              { name: 'caption', label: 'Caption', type: 'text' },
            ],
          },
        ],
      },
      {
        name: 'content',
        label: 'Content',
        type: 'blocks',
        blocks: [
          {
            blockType: 'photoBlock',
            fields: [
              { name: 'display', label: 'Display', type: 'text' },
              {
                name: 'gallery',
                label: 'Gallery',
                type: 'array',
                fields: [
                  {
                    name: 'alt',
                    label: 'Alt',
                    type: 'text',
                    ...(overrides.altVirtual === true ? { virtual: true } : {}),
                  },
                  { name: 'heroImage', label: 'Hero', type: 'image', upload: {} },
                ],
              },
            ],
          },
          // Same leaf name (`alt`) as photoBlock's gallery child. This is the
          // collision that an unqualified declaration path cannot resolve.
          {
            blockType: 'videoBlock',
            fields: [{ name: 'alt', label: 'Alt', type: 'text' }],
          },
        ],
      },
    ],
  }) as CollectionDefinition

// ---------------------------------------------------------------------------
// Dialect 1 — upload hook registry keys (DECLARATION paths)
//
// Produced by `indexUploadFields` (config/attach-hooks.ts), consumed as the
// keys of `ServerConfig.hooks.uploads`. Collection-prefixed, index-free, and
// block types are named explicitly. This is the only dialect that gets
// declaration paths fully right today.
// ---------------------------------------------------------------------------

describe('path dialect — upload hook registry keys', () => {
  const register = (key: string) => () =>
    prepareHookAttachment({
      collections: [fixture()],
      hooks: { uploads: { [key]: async () => ({}) } },
    })

  // Rejections assert on the message, not merely that something threw — a
  // bare try/catch would let an unrelated failure masquerade as the
  // path-resolution rejection under test.
  const unresolved = /references unknown or non-upload field/

  it('addresses a nested upload field with a collection-prefixed declaration path', () => {
    expect(register('pages.files.filesGroup.publicationFile')).not.toThrow()
  })

  it('qualifies a path through a blocks field with the block type', () => {
    // The other half of the elision claim. `storage-paths.test.node.ts` in
    // @byline/db-postgres derives this exact declaration path from real
    // flattener output by dropping index segments; here the real registry
    // accepts it. Neither package can import the other's half, so the two
    // tests meet at this literal.
    expect(register('pages.content.photoBlock.gallery.heroImage')).not.toThrow()
  })

  it('rejects the same path with the block type omitted', () => {
    expect(register('pages.content.gallery.heroImage')).toThrow(unresolved)
  })

  it('rejects item indices — these address declarations, not instances', () => {
    expect(register('pages.content.0.photoBlock.gallery.heroImage')).toThrow(unresolved)
  })
})

// ---------------------------------------------------------------------------
// Dialect 2 — admin `fields{}` override keys (DECLARATION paths, blocks barred)
//
// Consumed by `resolveSchemaPath` (config/validate-admin-configs.ts). Same
// declaration-addressing as the registry, plus one deliberate policy: keys
// may not traverse a `blocks` field at all, because fields inside a block
// take their overrides from the blockType-keyed `blockAdmin` registry so that
// one registration applies wherever the block renders.
// ---------------------------------------------------------------------------

describe('path dialect — admin fields{} override keys', () => {
  const admin = (key: string): CollectionAdminConfig =>
    ({ slug: 'pages', fields: { [key]: {} } }) as CollectionAdminConfig

  const validate = (key: string) => () => validateAdminConfigs([admin(key)], [fixture()])

  it('accepts a top-level field name', () => {
    expect(validate('title')).not.toThrow()
  })

  it('accepts a declaration path through array and group structure', () => {
    expect(validate('files.filesGroup.caption')).not.toThrow()
  })

  it('rejects an item index, naming the instance-path confusion', () => {
    expect(validate('files[0].filesGroup.caption')).toThrow(/index-free schema paths/)
  })

  it('rejects traversal into a block even when correctly block-qualified', () => {
    expect(validate('content.photoBlock.alt')).toThrow(/blockAdmin/)
  })

  it('rejects traversal into a block when unqualified', () => {
    expect(validate('content.alt')).toThrow(/blockAdmin/)
  })

  it('rejects a path that walks through a value field', () => {
    expect(validate('title.anything')).toThrow(/does not resolve to a field declaration/)
  })
})

describe('path dialect — block admin fields{} override keys', () => {
  const validate = (blockType: string, key: string) => () =>
    validateBlockAdminConfigs([{ blockType, fields: { [key]: {} } }], [fixture()])

  it('accepts a top-level field name of the block', () => {
    expect(validate('photoBlock', 'display')).not.toThrow()
  })

  it('accepts a declaration path through the block’s array structure', () => {
    expect(validate('photoBlock', 'gallery.alt')).not.toThrow()
  })

  it('rejects a key that does not resolve within the block', () => {
    expect(validate('photoBlock', 'gallery.missing')).toThrow(
      /does not resolve to a field declaration/
    )
  })

  it('resolves keys relative to the block root, not the collection', () => {
    // `content.photoBlock.gallery.alt` is the collection-rooted path; from the
    // block root the same field is just `gallery.alt`.
    expect(validate('photoBlock', 'content.photoBlock.gallery.alt')).toThrow(
      /does not resolve to a field declaration/
    )
  })
})

// ---------------------------------------------------------------------------
// Dialect 3 — boot-validation error message paths (DECLARATION paths, LOSSY)
//
// Produced by `walkFieldsWithPath` (config/validate-collections.ts) and
// interpolated into user-facing error messages. It walks into blocks but
// DROPS the block type, so it emits an ambiguous declaration path.
// ---------------------------------------------------------------------------

describe('path dialect — boot-validation error message paths', () => {
  /** The field path quoted in the virtual-field error, or null. */
  const pathInError = (): string | null => {
    try {
      validateCollections([fixture({ altVirtual: true })])
      return null
    } catch (error) {
      const match = (error as Error).message.match(/virtual field "([^"]+)"/)
      return match?.[1] ?? null
    }
  }

  it('KNOWN DEFECT: omits the block type, yielding an ambiguous path', () => {
    // Phase 2a makes this `content.photoBlock.gallery.alt`. When that lands,
    // update this expectation and delete the collision test below.
    expect(pathInError()).toBe('content.gallery.alt')
  })

  it('KNOWN DEFECT: the emitted path collides across block types', () => {
    // `photoBlock.gallery.alt` and `videoBlock.alt` are different declarations.
    // Neither is identifiable from the emitted path, because the block type —
    // the only thing distinguishing them — is exactly what gets dropped.
    const emitted = pathInError()
    expect(emitted).not.toContain('photoBlock')
    expect(emitted).not.toContain('videoBlock')
  })
})

// ---------------------------------------------------------------------------
// Dialect 4 — patch paths (INSTANCE paths)
//
// Parsed by `parsePatchPath` (patches/apply-patches.ts). Bracket indices, or
// `[id=…]` for stable item identity. Blocks are transparent: no block-type
// segment, because the addressed item carries its own `_type`.
// ---------------------------------------------------------------------------

describe('path dialect — patch paths', () => {
  it('addresses array items by positional bracket index', () => {
    expect(parsePatchPath('content[0].gallery[1].alt')).toEqual([
      { kind: 'field', key: 'content' },
      { kind: 'index', index: 0 },
      { kind: 'field', key: 'gallery' },
      { kind: 'index', index: 1 },
      { kind: 'field', key: 'alt' },
    ])
  })

  it('addresses array items by stable id', () => {
    expect(parsePatchPath('content[id=abc].gallery[id=def].alt')).toEqual([
      { kind: 'field', key: 'content' },
      { kind: 'id', id: 'abc' },
      { kind: 'field', key: 'gallery' },
      { kind: 'id', id: 'def' },
      { kind: 'field', key: 'alt' },
    ])
  })

  it('carries no block-type segment — the item resolves its own type', () => {
    const segments = parsePatchPath('content[0].alt')
    expect(segments).not.toContainEqual({ kind: 'field', key: 'photoBlock' })
  })

  it('cannot consume a storage path — dotted indices become field names', () => {
    // Storage emits `content.0.photoBlock.display`. Fed to the patch parser,
    // the index and block type silently become field keys. Not currently
    // reachable in product code, but nothing prevents it.
    expect(parsePatchPath('content.0.photoBlock.display')).toEqual([
      { kind: 'field', key: 'content' },
      { kind: 'field', key: '0' },
      { kind: 'field', key: 'photoBlock' },
      { kind: 'field', key: 'display' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Cross-dialect — the relationship the reconciliation is built on
// ---------------------------------------------------------------------------

describe('path dialects — cross-dialect relationships', () => {
  it('registry keys and admin keys agree on non-block structure', () => {
    // The same declaration, addressed by two dialects, differs only by the
    // collection prefix — no divergence in how group/array nesting is spelled.
    const registryKey = 'pages.files.filesGroup.publicationFile'
    const adminKey = 'files.filesGroup.publicationFile'
    expect(registryKey).toBe(`pages.${adminKey}`)

    expect(() =>
      prepareHookAttachment({
        collections: [fixture()],
        hooks: { uploads: { [registryKey]: async () => ({}) } },
      })
    ).not.toThrow()
    expect(() =>
      validateAdminConfigs(
        [{ slug: 'pages', fields: { [adminKey]: {} } } as CollectionAdminConfig],
        [fixture()]
      )
    ).not.toThrow()
  })
})
