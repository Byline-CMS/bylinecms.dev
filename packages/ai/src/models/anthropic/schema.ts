export const anthropicGenerationSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blocks'],
  properties: {
    title: { type: ['string', 'null'] },
    blocks: {
      type: 'array',
      items: { $ref: '#/$defs/Block' },
    },
  },
  $defs: {
    Marks: {
      type: 'object',
      additionalProperties: false,
      required: ['bold', 'italic', 'underline', 'code'],
      properties: {
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        underline: { type: 'boolean' },
        code: { type: 'boolean' },
      },
    },
    InlineText: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'text', 'marks'],
      properties: {
        kind: { const: 'text' },
        text: { type: 'string' },
        marks: { $ref: '#/$defs/Marks' },
      },
    },
    InlineLink: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'url', 'text', 'marks'],
      properties: {
        kind: { const: 'link' },
        url: { type: 'string' },
        text: { type: 'string' },
        marks: { $ref: '#/$defs/Marks' },
      },
    },
    InlineBr: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'br' } },
    },
    Inline: {
      anyOf: [
        { $ref: '#/$defs/InlineText' },
        { $ref: '#/$defs/InlineLink' },
        { $ref: '#/$defs/InlineBr' },
      ],
    },
    Paragraph: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'align', 'inlines'],
      properties: {
        kind: { const: 'paragraph' },
        align: { enum: ['start', 'center', 'right'] },
        inlines: { type: 'array', items: { $ref: '#/$defs/Inline' } },
      },
    },
    Heading: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'level', 'inlines'],
      properties: {
        kind: { const: 'heading' },
        level: { enum: [1, 2, 3] },
        inlines: { type: 'array', items: { $ref: '#/$defs/Inline' } },
      },
    },
    Quote: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'blocks'],
      properties: {
        kind: { const: 'quote' },
        blocks: { type: 'array', items: { $ref: '#/$defs/Paragraph' } },
      },
    },
    Hr: {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'hr' } },
    },
    ListItem: {
      type: 'object',
      additionalProperties: false,
      required: ['indent', 'blocks'],
      properties: {
        indent: { enum: [0, 1] },
        blocks: { type: 'array', items: { $ref: '#/$defs/Paragraph' } },
      },
    },
    List: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'listType', 'items'],
      properties: {
        kind: { const: 'list' },
        listType: { enum: ['bullet', 'number'] },
        items: { type: 'array', items: { $ref: '#/$defs/ListItem' } },
      },
    },
    Block: {
      anyOf: [
        { $ref: '#/$defs/Heading' },
        { $ref: '#/$defs/Paragraph' },
        { $ref: '#/$defs/List' },
        { $ref: '#/$defs/Quote' },
        { $ref: '#/$defs/Hr' },
      ],
    },
  },
} as const
