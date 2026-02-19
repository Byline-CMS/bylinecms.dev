// Example collection definition and layout for the Docs collection.
// These are design-time examples and not yet wired into runtime.

import type { CollectionDefinition } from '../@types/collection-types.js'
import type { LayoutCollection } from '../layout/layout-types.js'

export const DocsCollectionExample: CollectionDefinition = {
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
      type: 'array',
      fields: [
        {
          name: 'richTextBlock',
          label: 'Richtext Block',
          type: 'block',
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
          type: 'block',
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
          type: 'array',
          fields: [
            { name: 'rating', label: 'Rating', type: 'integer' },
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

export const DocsLayoutExample: LayoutCollection = {
  id: 'docs',
  tabs: [
    {
      id: 'details',
      label: 'Details',
      sections: [
        {
          kind: 'section',
          id: 'main-details',
          fields: [
            {
              kind: 'row',
              id: 'title-row',
              fields: [{ target: 'title' }, { target: 'path' }],
            },
            { target: 'summary' },
          ],
        },
      ],
    },
    {
      id: 'content',
      label: 'Content',
      sections: [
        {
          kind: 'section',
          id: 'content-section',
          fields: [{ target: 'content' }],
        },
      ],
    },
    {
      id: 'meta',
      label: 'Meta',
      sections: [
        {
          kind: 'section',
          id: 'meta-section',
          fields: [
            { target: 'publishedOn' },
            { target: 'featured' },
            { target: 'reviews' },
            { target: 'links' },
          ],
        },
      ],
    },
  ],
  blocks: [
    {
      target: 'content',
      allowedBlockTypes: ['richTextBlock', 'photoBlock'],
    },
  ],
}
