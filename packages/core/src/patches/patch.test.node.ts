import { describe, expect, it } from 'vitest'

import { applyPatches, parsePatchPath } from './apply-patches.js'
import type { CollectionDefinition } from '../@types/collection-types.js'
import type { DocumentPatch } from './patch-types.js'

const DocsDefinition: CollectionDefinition = {
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  fields: [
    { name: 'path', label: 'Path', type: 'text' },
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'summary', label: 'Summary', type: 'textArea', optional: true, localized: true },
    {
      name: 'publishedOn',
      label: 'Published On',
      type: 'datetime',
      mode: 'datetime',
    },
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
      optional: true,
    },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      optional: true,
      blocks: [
        {
          blockType: 'richTextBlock',
          label: 'Richtext Block',
          fields: [
            {
              name: 'richText',
              label: 'Richtext',
              type: 'richText',
              optional: true,
            },
            {
              name: 'constrainedWidth',
              label: 'Constrained Width',
              type: 'checkbox',
              optional: true,
            },
          ],
        },
        {
          blockType: 'photoBlock',
          label: 'Photo Block',
          fields: [
            { name: 'display', label: 'Display', type: 'text', optional: true },
            { name: 'photo', label: 'Photo', type: 'image' },
            { name: 'alt', label: 'Alt', type: 'text' },
            { name: 'caption', label: 'Caption', type: 'richText', optional: true },
          ],
        },
      ],
    },
    {
      name: 'reviews',
      label: 'Reviews',
      type: 'array',
      optional: true,
      fields: [
        {
          name: 'reviewItem',
          label: 'Review Item',
          type: 'group',
          fields: [
            { name: 'rating', label: 'Rating', type: 'integer' },
            { name: 'comment', label: 'Comments', type: 'richText', optional: true },
          ],
        },
      ],
    },
    {
      name: 'links',
      label: 'Links',
      type: 'array',
      optional: true,
      fields: [{ name: 'link', label: 'Link', type: 'text' }],
    },
  ],
}

const DocsPatchExample: DocumentPatch[] = [
  {
    kind: 'field.set',
    path: 'title',
    value: 'Updated title via patch',
  },
]

interface DocsLike {
  title?: string
  path?: string
  summary?: string
}

describe('applyPatches', () => {
  it('applies DocsPatchExample to a simple doc object', () => {
    const original: DocsLike = {
      title: 'Original title',
      path: '/docs/original',
      summary: 'Original summary',
    }

    const { doc, errors } = applyPatches(DocsDefinition, original, DocsPatchExample)

    expect(errors).toHaveLength(0)
    const patched = doc as DocsLike

    expect(patched.title).toBe('Updated title via patch')
    expect(patched.path).toBe(original.path)
    expect(patched.summary).toBe(original.summary)
  })

  it('leaves the document unchanged when no patches are provided', () => {
    const original: DocsLike = {
      title: 'Original title',
      path: '/docs/original',
      summary: 'Original summary',
    }

    const { doc, errors } = applyPatches(DocsDefinition, original, [])

    expect(errors).toHaveLength(0)
    expect(doc).toEqual(original)
  })

  it('reports an error for unsupported patch kinds', () => {
    const original: DocsLike = {
      title: 'Original title',
    }

    const { errors } = applyPatches(DocsDefinition, original, [
      // @ts-expect-error - intentionally passing an unsupported kind to verify type narrowing behaviour
      { kind: 'unknown.kind', path: 'links' },
    ])

    expect(errors.length).toBe(1)
    expect(errors[0]?.message).toContain('Unsupported patch kind')
  })

  it('supports array.insert and array.move with stable ids', () => {
    const original = {
      reviews: [
        { _id: 'a', rating: 3 },
        { _id: 'b', rating: 4 },
      ],
    }

    const { doc: afterInsert, errors: insertErrors } = applyPatches(DocsDefinition, original, [
      {
        kind: 'array.insert',
        path: 'reviews',
        index: 1,
        item: { _id: 'c', rating: 5 },
      },
    ])

    expect(insertErrors).toHaveLength(0)

    const inserted = afterInsert as { reviews: { _id: string; rating: number }[] }
    expect(inserted.reviews.map((r) => r._id)).toEqual(['a', 'c', 'b'])

    const { doc: afterMove, errors: moveErrors } = applyPatches(DocsDefinition, inserted, [
      {
        kind: 'array.move',
        path: 'reviews',
        itemId: 'c',
        toIndex: 0,
      },
    ])

    expect(moveErrors).toHaveLength(0)
    const moved = afterMove as { reviews: { _id: string; rating: number }[] }
    expect(moved.reviews.map((r) => r._id)).toEqual(['c', 'a', 'b'])
  })

  it('array.remove removes an item by stable _id', () => {
    const original = {
      reviews: [
        { _id: 'a', rating: 3 },
        { _id: 'b', rating: 4 },
        { _id: 'c', rating: 5 },
      ],
    }

    const { doc, errors } = applyPatches(DocsDefinition, original, [
      { kind: 'array.remove', path: 'reviews', itemId: 'b' },
    ])

    expect(errors).toHaveLength(0)
    const result = doc as { reviews: { _id: string }[] }
    expect(result.reviews.map((r) => r._id)).toEqual(['a', 'c'])
  })

  it('array.remove falls back to a positional index for items without stable ids', () => {
    // Regression: an admin session can add an item (no _id yet) and remove
    // it in the same save; the remove patch carries the item's index. This
    // previously no-opped silently and the "removed" item reappeared.
    const original = {
      reviews: [{ rating: 3 }, { rating: 4 }, { rating: 5 }],
    }

    const { doc, errors } = applyPatches(DocsDefinition, original, [
      { kind: 'array.remove', path: 'reviews', itemId: '1' },
    ])

    expect(errors).toHaveLength(0)
    const result = doc as { reviews: { rating: number }[] }
    expect(result.reviews.map((r) => r.rating)).toEqual([3, 5])
  })

  it('array.remove of a missing itemId is an idempotent no-op', () => {
    const original = {
      reviews: [{ _id: 'a', rating: 3 }],
    }

    const { doc, errors } = applyPatches(DocsDefinition, original, [
      { kind: 'array.remove', path: 'reviews', itemId: 'gone' },
    ])

    expect(errors).toHaveLength(0)
    expect((doc as { reviews: unknown[] }).reviews).toHaveLength(1)
  })

  it('does NOT misread a digit-prefixed uuid as an index (strict integer fallback)', () => {
    // Number.parseInt('3f2a…') === 3 — a real-but-absent _id starting with
    // digits must not resolve to a positional index and hit the wrong item.
    const original = {
      reviews: [
        { _id: 'a', rating: 1 },
        { _id: 'b', rating: 2 },
        { _id: 'c', rating: 3 },
        { _id: 'd', rating: 4 },
      ],
    }

    const removeResult = applyPatches(DocsDefinition, original, [
      { kind: 'array.remove', path: 'reviews', itemId: '3f2a09c1-dead-beef-0000-000000000000' },
    ])
    expect(removeResult.errors).toHaveLength(0)
    // Nothing removed — in particular NOT the item at index 3.
    expect((removeResult.doc as { reviews: unknown[] }).reviews).toHaveLength(4)

    const moveResult = applyPatches(DocsDefinition, original, [
      {
        kind: 'array.move',
        path: 'reviews',
        itemId: '3f2a09c1-dead-beef-0000-000000000000',
        toIndex: 0,
      },
    ])
    // array.move keeps its throw-on-missing contract.
    expect(moveResult.errors).toHaveLength(1)
    expect(moveResult.errors[0]?.message).toContain('not found')
  })

  it('array.insert followed by array.remove of the same _id within one patch batch', () => {
    // Mirrors the admin flow after the fix: add assigns _id client-side, so
    // add-then-remove in a single editing session round-trips cleanly.
    const original = { reviews: [{ _id: 'a', rating: 3 }] }

    const { doc, errors } = applyPatches(DocsDefinition, original, [
      { kind: 'array.insert', path: 'reviews', index: 1, item: { _id: 'new-1', rating: 5 } },
      { kind: 'array.remove', path: 'reviews', itemId: 'new-1' },
    ])

    expect(errors).toHaveLength(0)
    const result = doc as { reviews: { _id: string }[] }
    expect(result.reviews.map((r) => r._id)).toEqual(['a'])
  })

  it('supports block.add and block.updateField on content blocks', () => {
    const original = {
      content: [],
    }

    const { doc: afterAdd, errors: addErrors } = applyPatches(DocsDefinition, original, [
      {
        kind: 'block.add',
        path: 'content',
        blockType: 'richTextBlock',
        initialValue: {
          richText: { ops: [{ insert: 'Hello' }] },
        },
      },
    ])

    expect(addErrors).toHaveLength(0)

    const withBlock = afterAdd as {
      content: [{ _id: string; _type: string; richText?: unknown }]
    }

    expect(withBlock.content).toHaveLength(1)
    const block = withBlock.content[0]
    expect(block?._type).toBe('richTextBlock')
    expect(block?.richText).toEqual({ ops: [{ insert: 'Hello' }] })

    const { doc: afterUpdate, errors: updateErrors } = applyPatches(DocsDefinition, withBlock, [
      {
        kind: 'block.updateField',
        path: 'content',
        blockId: block._id,
        fieldPath: 'constrainedWidth',
        value: true,
      },
    ])

    expect(updateErrors).toHaveLength(0)
    const updated = afterUpdate as {
      content: { _id: string; _type: string; constrainedWidth?: boolean }[]
    }

    expect(updated.content[0]?.constrainedWidth).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Patch paths are instance paths
//
// `parsePatchPath` delegates to the shared grammar's `parseInstancePath`
// (`@byline/core` `paths/`). The two agree on every well-formed path; they
// differ only in that a malformed one is now rejected rather than partially
// parsed.
// ---------------------------------------------------------------------------

describe('parsePatchPath — shared instance-path grammar', () => {
  it('parses positional and id selectors', () => {
    expect(parsePatchPath('content[0].gallery[1].alt')).toEqual([
      { kind: 'field', key: 'content' },
      { kind: 'index', index: 0 },
      { kind: 'field', key: 'gallery' },
      { kind: 'index', index: 1 },
      { kind: 'field', key: 'alt' },
    ])
    expect(parsePatchPath('content[id=abc].alt')).toEqual([
      { kind: 'field', key: 'content' },
      { kind: 'id', id: 'abc' },
      { kind: 'field', key: 'alt' },
    ])
  })

  it('carries no block-type segment — the addressed item holds its own `_type`', () => {
    expect(parsePatchPath('content[0].alt')).not.toContainEqual({
      kind: 'field',
      key: 'photoBlock',
    })
  })

  it('rejects a malformed path instead of parsing it partially', () => {
    // Previously `'a['` yielded `[{ kind: 'field', key: 'a' }]`, so a patch
    // was applied at `a` — a path the client never addressed. Returning no
    // segments makes callers reject the patch instead.
    for (const malformed of ['a[', 'a[]', 'a[x]', 'a]b', 'a..b']) {
      expect(parsePatchPath(malformed)).toEqual([])
    }
  })

  it('surfaces a malformed path as a patch error rather than a silent write', () => {
    const original = { title: 'original' }
    const { doc, errors } = applyPatches(DocsDefinition, original, [
      { kind: 'field.set', path: 'title[', value: 'injected' } as unknown as DocumentPatch,
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/unparseable path/i)
    // The truncated path `title` is never written.
    expect((doc as { title?: string }).title).toBe('original')
  })
})
