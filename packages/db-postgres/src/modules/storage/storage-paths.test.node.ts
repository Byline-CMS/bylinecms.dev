/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldSet } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { flattenFieldSetData } from './storage-flatten.js'

// ---------------------------------------------------------------------------
// Characterization tests for the STORAGE path dialect, and for the one
// cross-dialect relationship the reconciliation design rests on.
//
// Companion to `packages/core/src/paths/path-dialects.test.node.ts`, which
// pins the config-time dialects. This file lives here because the flattener
// lives here and core cannot import it (wrong dependency direction).
//
// The reverse direction is closed too: `prepareHookAttachment` is internal to
// core's config module and not on any public entry point, so the "the registry
// accepts this key" half of the elision claim is asserted in the core file.
// The two meet at the declaration path `content.photoBlock.gallery.heroImage`
// — derived from real flattener output here, fed to the real registry there.
//
// Pure — no Postgres. Runs under `--mode=node`.
//
// Storage paths are PERSISTED. Unlike the config-time dialects they are not
// a candidate for change: altering this grammar is a data migration. These
// tests exist to document the format precisely and to guard the elision
// relationship below.
// ---------------------------------------------------------------------------

const fields: FieldSet = [
  { name: 'title', label: 'Title', type: 'text' },
  {
    name: 'files',
    label: 'Files',
    type: 'array',
    fields: [
      {
        name: 'filesGroup',
        type: 'group',
        fields: [{ name: 'caption', label: 'Caption', type: 'text' }],
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
              { name: 'alt', label: 'Alt', type: 'text' },
              { name: 'heroImage', label: 'Hero', type: 'image', upload: {} },
            ],
          },
        ],
      },
    ],
  },
] as FieldSet

const storedFile = {
  fileId: '0193f000-0000-7000-8000-000000000001',
  filename: 'hero.jpg',
  originalFilename: 'hero.jpg',
  fileSize: 2048,
  mimeType: 'image/jpeg',
  storageProvider: 'local',
  storagePath: 'uploads/hero.jpg',
}

const data = {
  title: 'Hello',
  files: [{ filesGroup: { caption: 'cap0' } }],
  content: [
    {
      _type: 'photoBlock',
      display: 'wide',
      // The second item carries the upload field, so the elision tests below
      // work from a path the flattener actually emitted rather than one typed
      // out by hand.
      gallery: [{ alt: 'a0' }, { alt: 'a1', heroImage: storedFile }],
    },
  ],
}

/** Value-bearing paths only — meta rows carry item identity, not values. */
const valuePaths = (): string[] =>
  flattenFieldSetData(fields, data as never, 'en')
    .filter((row) => row.field_type !== 'meta')
    .map((row) => row.field_path.join('.'))

describe('path dialect — storage field_path', () => {
  it('addresses a top-level field by name alone', () => {
    expect(valuePaths()).toContain('title')
  })

  it('gives array items a positional dotted index after the field name', () => {
    expect(valuePaths()).toContain('files.0.filesGroup.caption')
  })

  it('gives block items an index followed by the block type', () => {
    // Note the ordering: index first, THEN the discriminator. A block item is
    // located positionally, and the type describes what was found there.
    expect(valuePaths()).toContain('content.0.photoBlock.display')
  })

  it('nests an array inside a block with its own index', () => {
    expect(valuePaths()).toEqual(
      expect.arrayContaining([
        'content.0.photoBlock.gallery.0.alt',
        'content.0.photoBlock.gallery.1.alt',
      ])
    )
  })

  it('addresses an upload field nested inside a block’s array', () => {
    expect(valuePaths()).toContain('content.0.photoBlock.gallery.1.heroImage')
  })

  it('omits absent values entirely rather than emitting nulls', () => {
    // Only gallery item 1 carries a heroImage; item 0 emits no path for it.
    expect(valuePaths()).not.toContain('content.0.photoBlock.gallery.0.heroImage')
  })
})

// ---------------------------------------------------------------------------
// The elision relationship
//
// Storage paths are INSTANCE paths; upload registry keys are DECLARATION
// paths. The claim underpinning the reconciliation design is that these are
// the same grammar, differing only in whether index segments are present.
//
// If this test fails, the "one AST, two serialisations" premise is wrong and
// the plan needs revisiting — not the test.
// ---------------------------------------------------------------------------

describe('path dialects — storage elides to registry declaration paths', () => {
  /**
   * Drop positional index segments from an instance path.
   *
   * Deliberately naive: it cannot distinguish an index from a field literally
   * named `0`, because a string has no structure to consult. That ambiguity
   * is the argument for a shared, schema-aware parser rather than the string
   * munging each call site currently hand-rolls.
   */
  const elideIndices = (instancePath: string): string =>
    instancePath
      .split('.')
      .filter((segment) => !/^\d+$/.test(segment))
      .join('.')

  /** The emitted storage path for the nested upload field. */
  const emittedUploadPath = (): string => {
    const found = valuePaths().find((p) => p.endsWith('heroImage'))
    if (found == null) throw new Error('fixture no longer emits a heroImage path')
    return found
  }

  it('yields the upload registry declaration path for a field inside a block', () => {
    // Derived from real flattener output, not a hand-written literal — the
    // premise is worthless if the input is something someone assumed.
    expect(elideIndices(emittedUploadPath())).toBe('content.photoBlock.gallery.heroImage')
  })

  it('holds for group and array nesting outside blocks', () => {
    const caption = valuePaths().find((p) => p.endsWith('caption'))
    expect(elideIndices(caption ?? '')).toBe('files.filesGroup.caption')
  })

  it('preserves the block type, which the declaration path requires', () => {
    // Elision removes only positional information. The discriminator survives,
    // which is exactly what distinguishes a usable declaration path from the
    // ambiguous one boot-validation errors currently emit.
    expect(elideIndices(emittedUploadPath())).toContain('photoBlock')
  })
})
