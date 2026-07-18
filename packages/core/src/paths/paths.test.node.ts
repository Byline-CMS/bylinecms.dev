/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { validateAdminConfigs } from '../config/validate-admin-configs.js'
import {
  formatDeclarationPath,
  formatInstancePath,
  parseDeclarationPath,
  parseInstancePath,
  resolveDeclarationPath,
  toDeclarationSegments,
  walkFieldDeclarations,
} from './index.js'
import type { CollectionAdminConfig, CollectionDefinition, FieldSet } from '../@types/index.js'

// The same structural shape the characterization suite uses: array→group
// nesting, a blocks field, an array inside a block, and two block types that
// each declare `alt` — the collision an unqualified path cannot resolve.
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
          {
            name: 'gallery',
            label: 'Gallery',
            type: 'array',
            fields: [{ name: 'alt', label: 'Alt', type: 'text' }],
          },
        ],
      },
      { blockType: 'videoBlock', fields: [{ name: 'alt', label: 'Alt', type: 'text' }] },
    ],
  },
] as FieldSet

describe('parseDeclarationPath', () => {
  it('splits a dotted path into field segments', () => {
    expect(parseDeclarationPath('files.filesGroup.caption')).toEqual({
      ok: true,
      segments: [
        { kind: 'field', name: 'files' },
        { kind: 'field', name: 'filesGroup' },
        { kind: 'field', name: 'caption' },
      ],
    })
  })

  it('cannot classify a block type on its own — that needs the schema', () => {
    // `photoBlock` comes back as a field segment. Only resolution against a
    // field set can tell it apart from a field of the same name.
    const parsed = parseDeclarationPath('content.photoBlock.gallery.alt')
    expect(parsed.ok && parsed.segments.every((s) => s.kind === 'field')).toBe(true)
  })

  it('rejects item indices rather than silently dropping them', () => {
    expect(parseDeclarationPath('files[0].filesGroup.caption')).toEqual({
      ok: false,
      reason: 'index',
    })
  })

  it('rejects empty paths and empty segments', () => {
    expect(parseDeclarationPath('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseDeclarationPath('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(parseDeclarationPath('a..b')).toEqual({ ok: false, reason: 'emptySegment' })
    expect(parseDeclarationPath('.a')).toEqual({ ok: false, reason: 'emptySegment' })
    expect(parseDeclarationPath('a.')).toEqual({ ok: false, reason: 'emptySegment' })
  })
})

describe('parseInstancePath', () => {
  it('reads positional item selectors', () => {
    expect(parseInstancePath('content[0].gallery[1].alt')).toEqual({
      ok: true,
      segments: [
        { kind: 'field', name: 'content' },
        { kind: 'index', index: 0 },
        { kind: 'field', name: 'gallery' },
        { kind: 'index', index: 1 },
        { kind: 'field', name: 'alt' },
      ],
    })
  })

  it('reads stable-id item selectors', () => {
    expect(parseInstancePath('content[id=abc].alt')).toEqual({
      ok: true,
      segments: [
        { kind: 'field', name: 'content' },
        { kind: 'id', id: 'abc' },
        { kind: 'field', name: 'alt' },
      ],
    })
  })

  it('rejects malformed bracket syntax instead of truncating', () => {
    for (const bad of ['a[', 'a[]', 'a[x]', 'a]b']) {
      expect(parseInstancePath(bad).ok).toBe(false)
    }
  })
})

describe('formatting', () => {
  it('round-trips a declaration path', () => {
    const parsed = parseDeclarationPath('files.filesGroup.caption')
    expect(parsed.ok && formatDeclarationPath(parsed.segments)).toBe('files.filesGroup.caption')
  })

  it('round-trips an instance path', () => {
    const parsed = parseInstancePath('content[0].gallery[1].alt')
    expect(parsed.ok && formatInstancePath(parsed.segments)).toBe('content[0].gallery[1].alt')
  })

  it('renders a block type in declaration form and omits it in instance form', () => {
    const segments = [
      { kind: 'field', name: 'content' },
      { kind: 'blockType', blockType: 'photoBlock' },
      { kind: 'field', name: 'alt' },
    ] as const
    expect(formatDeclarationPath(segments)).toBe('content.photoBlock.alt')
    expect(formatInstancePath(segments)).toBe('content.alt')
  })
})

describe('toDeclarationSegments', () => {
  it('drops item selectors and keeps the block type', () => {
    const parsed = parseInstancePath('content[0].gallery[1].alt')
    expect(parsed.ok && formatDeclarationPath(toDeclarationSegments(parsed.segments))).toBe(
      'content.gallery.alt'
    )
  })

  it('preserves a field whose name is numeric', () => {
    // The regex-over-text approach each call site hand-rolls today deletes
    // this segment. Working over typed segments cannot: `0` here is a field.
    const parsed = parseInstancePath('weird.0.value')
    expect(parsed.ok && formatDeclarationPath(toDeclarationSegments(parsed.segments))).toBe(
      'weird.0.value'
    )
  })
})

describe('walkFieldDeclarations', () => {
  const collect = (): string[] => {
    const out: string[] = []
    walkFieldDeclarations(fields, (_field, segments) => {
      out.push(formatDeclarationPath(segments))
    })
    return out
  }

  it('qualifies paths through a blocks field with the block type', () => {
    expect(collect()).toEqual(
      expect.arrayContaining([
        'title',
        'files.filesGroup.caption',
        'content.photoBlock.gallery.alt',
        'content.videoBlock.alt',
      ])
    )
  })

  it('keeps same-named fields in different blocks distinct', () => {
    // The defect this walk exists to prevent: without the block type both of
    // these collapse to `content.alt` and become unidentifiable.
    const alts = collect().filter((p) => p.endsWith('.alt'))
    expect(new Set(alts).size).toBe(alts.length)
  })

  it('visits structure fields themselves, not only leaves', () => {
    expect(collect()).toEqual(expect.arrayContaining(['files', 'files.filesGroup', 'content']))
  })
})

describe('resolveDeclarationPath', () => {
  it('resolves a path through array and group structure', () => {
    const result = resolveDeclarationPath(fields, 'files.filesGroup.caption')
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.field.name).toBe('caption')
  })

  it('reclassifies a block-type segment the parser could not identify', () => {
    const result = resolveDeclarationPath(fields, 'content.photoBlock.gallery.alt')
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.segments[1]).toEqual({
      kind: 'blockType',
      blockType: 'photoBlock',
    })
  })

  it('distinguishes same-named fields in different blocks', () => {
    const photo = resolveDeclarationPath(fields, 'content.photoBlock.gallery.alt')
    const video = resolveDeclarationPath(fields, 'content.videoBlock.alt')
    expect(photo.status).toBe('ok')
    expect(video.status).toBe('ok')
  })

  it('reports `blocks` rather than `unresolved` when traversal is barred', () => {
    const result = resolveDeclarationPath(fields, 'content.photoBlock.gallery.alt', {
      blocks: 'forbidden',
    })
    expect(result).toEqual({ status: 'blocks', at: 0 })
  })

  it('reports `blocks` even for an unqualified path into a block', () => {
    expect(resolveDeclarationPath(fields, 'content.alt', { blocks: 'forbidden' }).status).toBe(
      'blocks'
    )
  })

  it('rejects an unknown block type', () => {
    expect(resolveDeclarationPath(fields, 'content.audioBlock.alt').status).toBe('unresolved')
  })

  it('rejects a path that stops on the block type', () => {
    // Addresses a block, not a field declaration.
    expect(resolveDeclarationPath(fields, 'content.photoBlock').status).toBe('unresolved')
  })

  it('rejects a path walking through a value field', () => {
    expect(resolveDeclarationPath(fields, 'title.anything').status).toBe('unresolved')
  })

  it('rejects instance segments passed where a declaration is required', () => {
    expect(resolveDeclarationPath(fields, 'files[0].filesGroup.caption').status).toBe('unresolved')
  })

  it('resolves a structure field addressed on its own', () => {
    expect(resolveDeclarationPath(fields, 'files').status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Equivalence with the validator this module will replace.
//
// Phase 2c swaps `validate-admin-configs`' private `resolveSchemaPath` for
// `resolveDeclarationPath({ blocks: 'forbidden' })`. That is only safe if the
// two agree on every key today, so assert it directly rather than assuming.
// ---------------------------------------------------------------------------

describe('resolveDeclarationPath — agreement with the admin fields{} validator', () => {
  const collection = {
    path: 'pages',
    labels: { singular: 'Page', plural: 'Pages' },
    useAsTitle: 'title',
    fields,
  } as CollectionDefinition

  const validatorAccepts = (key: string): boolean => {
    try {
      validateAdminConfigs(
        [{ slug: 'pages', fields: { [key]: {} } } as CollectionAdminConfig],
        [collection]
      )
      return true
    } catch {
      return false
    }
  }

  const resolverAccepts = (key: string): boolean =>
    resolveDeclarationPath(fields, key, { blocks: 'forbidden' }).status === 'ok'

  const keys = [
    'title',
    'files',
    'files.filesGroup',
    'files.filesGroup.caption',
    'files.filesGroup.missing',
    'files[0].filesGroup.caption',
    'title.anything',
    'content',
    'content.alt',
    'content.photoBlock.gallery.alt',
    'missing',
    '',
  ]

  for (const key of keys) {
    it(`agrees on ${key === '' ? '<empty>' : key}`, () => {
      expect(resolverAccepts(key)).toBe(validatorAccepts(key))
    })
  }
})
