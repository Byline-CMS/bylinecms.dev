import { defineBlock, defineCollection } from '../../@types/collection-types.js'

export const QuoteBlock = defineBlock({
  blockType: "quote'block",
  fields: [
    { name: 'quotation', type: 'textArea', localized: true },
    {
      name: "tone'choice",
      type: 'select',
      optional: true,
      options: [
        { label: 'Calm', value: 'calm' },
        { label: 'Quoted', value: "author's" },
      ],
    },
  ],
})

export const MediaBlock = defineBlock({
  blockType: 'media',
  fields: [
    { name: 'caption', type: 'text', localized: true, optional: true },
    { name: 'image', type: 'image' },
  ],
})

export const AllFieldsCollection = defineCollection({
  path: 'all-fields',
  labels: { singular: 'All fields', plural: 'All fields' },
  fields: [
    { name: 'integer', type: 'integer' },
    { name: 'float', type: 'float' },
    { name: 'counter', type: 'counter', group: 'fixture' },
    { name: 'decimal', type: 'decimal' },
    { name: 'date', type: 'date' },
    { name: 'datetime', type: 'datetime' },
    { name: 'time', type: 'time' },
    { name: 'text', type: 'text' },
    { name: 'localizedText', type: 'text', localized: true },
    { name: 'textArea', type: 'textArea' },
    { name: 'boolean', type: 'boolean' },
    { name: 'checkbox', type: 'checkbox' },
    {
      name: 'select',
      type: 'select',
      options: [
        { label: 'First', value: 'first' },
        { label: 'Second', value: "second's" },
      ],
    },
    { name: 'json', type: 'json' },
    { name: 'localizedJson', type: 'json', localized: true },
    { name: 'object', type: 'object' },
    { name: 'richText', type: 'richText' },
    { name: 'file', type: 'file' },
    { name: 'image', type: 'image' },
    { name: 'relation', type: 'relation', targetCollection: 'people' },
    {
      name: 'relations',
      type: 'relation',
      targetCollection: 'people',
      hasMany: true,
    },
    {
      name: 'optionalText',
      type: 'text',
      optional: true,
    },
    {
      name: 'group',
      type: 'group',
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'enabled', type: 'boolean', optional: true },
      ],
    },
    {
      name: 'array',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', localized: true },
        { name: 'score', type: 'integer', optional: true },
      ],
    },
    {
      name: "content's",
      type: 'blocks',
      blocks: [QuoteBlock, MediaBlock],
    },
  ],
})

export const MinimalCollection = defineCollection({
  path: 'minimal',
  labels: { singular: 'Minimal', plural: 'Minimal' },
  fields: [{ name: 'title', type: 'text' }],
})

export const AllFieldsCollections = [AllFieldsCollection, MinimalCollection] as const
