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
