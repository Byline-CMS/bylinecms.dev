import { describe, expect, it } from 'vitest'

import { applyPatches } from './apply-patches.js'
import type { CollectionDefinition } from '../@types/collection-types.js'
import type { DocumentPatch } from './patch-types.js'

const DocsDefinition: CollectionDefinition = {
  path: 'docs',
  labels: {
    singular: 'Document',
    plural: 'Documents',
  },
  fields: [
    { name: 'path', label: 'Path', type: 'text', required: true },
    { name: 'title', label: 'Title', type: 'text', required: true },
    { name: 'summary', label: 'Summary', type: 'textArea', localized: true },
    {
      name: 'publishedOn',
      label: 'Published On',
      type: 'datetime',
      mode: 'datetime',
      required: true,
    },
    {
      name: 'featured',
      label: 'Featured',
      type: 'checkbox',
    },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      fields: [
        {
          name: 'richTextBlock',
          label: 'Richtext Block',
          type: 'group',
          fields: [
            {
              name: 'richText',
              label: 'Richtext',
              type: 'richText',
            },
            {
              name: 'constrainedWidth',
              label: 'Constrained Width',
              type: 'checkbox',
            },
          ],
        },
        {
          name: 'photoBlock',
          label: 'Photo Block',
          type: 'group',
          fields: [
            { name: 'display', label: 'Display', type: 'text' },
            { name: 'photo', label: 'Photo', type: 'image' },
            { name: 'alt', label: 'Alt', type: 'text' },
            { name: 'caption', label: 'Caption', type: 'richText' },
          ],
        },
      ],
    },
    {
      name: 'reviews',
      label: 'Reviews',
      type: 'array',
      fields: [
        {
          name: 'reviewItem',
          label: 'Review Item',
          type: 'group',
          fields: [
            { name: 'rating', label: 'Rating', type: 'integer', required: true },
            { name: 'comment', label: 'Comments', type: 'richText' },
          ],
        },
      ],
    },
    {
      name: 'links',
      label: 'Links',
      type: 'array',
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
        { id: 'a', rating: 3 },
        { id: 'b', rating: 4 },
      ],
    }

    const { doc: afterInsert, errors: insertErrors } = applyPatches(DocsDefinition, original, [
      {
        kind: 'array.insert',
        path: 'reviews',
        index: 1,
        item: { id: 'c', rating: 5 },
      },
    ])

    expect(insertErrors).toHaveLength(0)

    const inserted = afterInsert as { reviews: { id: string; rating: number }[] }
    expect(inserted.reviews.map((r) => r.id)).toEqual(['a', 'c', 'b'])

    const { doc: afterMove, errors: moveErrors } = applyPatches(DocsDefinition, inserted, [
      {
        kind: 'array.move',
        path: 'reviews',
        itemId: 'c',
        toIndex: 0,
      },
    ])

    expect(moveErrors).toHaveLength(0)
    const moved = afterMove as { reviews: { id: string; rating: number }[] }
    expect(moved.reviews.map((r) => r.id)).toEqual(['c', 'a', 'b'])
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
      content: [{ id: string; type: string; richText?: unknown }]
    }

    expect(withBlock.content).toHaveLength(1)
    const block = withBlock.content[0]
    expect(block?.type).toBe('group')
    expect(block?.richText).toEqual({ ops: [{ insert: 'Hello' }] })

    const { doc: afterUpdate, errors: updateErrors } = applyPatches(DocsDefinition, withBlock, [
      {
        kind: 'block.updateField',
        path: 'content',
        blockId: block.id,
        fieldPath: 'constrainedWidth',
        value: true,
      },
    ])

    expect(updateErrors).toHaveLength(0)
    const updated = afterUpdate as {
      content: { id: string; type: string; constrainedWidth?: boolean }[]
    }

    expect(updated.content[0]?.constrainedWidth).toBe(true)
  })
})
