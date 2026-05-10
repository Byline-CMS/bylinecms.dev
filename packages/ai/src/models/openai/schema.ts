export const openaiHtmlGenerationSchema = {
  name: 'html_generation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      html: {
        type: 'string',
        description: 'The generated HTML content.',
      },
    },
    required: ['html'],
  },
}

export const openaiGenerationSchema = {
  name: 'lexical_doc_blocks_v1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      blocks: {
        type: 'array',
        items: {
          anyOf: [
            {
              // Heading
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['heading'] },
                level: { type: 'number', enum: [1, 2, 3] },
                inlines: {
                  type: 'array',
                  items: {
                    anyOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          kind: { type: 'string', enum: ['text'] },
                          text: { type: 'string' },
                          marks: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              bold: { type: 'boolean' },
                              italic: { type: 'boolean' },
                              underline: { type: 'boolean' },
                              code: { type: 'boolean' },
                            },
                            required: ['bold', 'italic', 'underline', 'code'],
                          },
                        },
                        required: ['kind', 'text', 'marks'],
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          kind: { type: 'string', enum: ['link'] },
                          url: { type: 'string' },
                          text: { type: 'string' },
                          marks: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              bold: { type: 'boolean' },
                              italic: { type: 'boolean' },
                              underline: { type: 'boolean' },
                              code: { type: 'boolean' },
                            },
                            required: ['bold', 'italic', 'underline', 'code'],
                          },
                        },
                        required: ['kind', 'url', 'text', 'marks'],
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: { kind: { type: 'string', enum: ['br'] } },
                        required: ['kind'],
                      },
                    ],
                  },
                },
              },
              required: ['kind', 'level', 'inlines'],
            },
            {
              // Paragraph
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['paragraph'] },
                align: { type: 'string', enum: ['start', 'center', 'right'] },
                inlines: {
                  type: 'array',
                  items: {
                    anyOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          kind: { type: 'string', enum: ['text'] },
                          text: { type: 'string' },
                          marks: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              bold: { type: 'boolean' },
                              italic: { type: 'boolean' },
                              underline: { type: 'boolean' },
                              code: { type: 'boolean' },
                            },
                            required: ['bold', 'italic', 'underline', 'code'],
                          },
                        },
                        required: ['kind', 'text', 'marks'],
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          kind: { type: 'string', enum: ['link'] },
                          url: { type: 'string' },
                          text: { type: 'string' },
                          marks: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                              bold: { type: 'boolean' },
                              italic: { type: 'boolean' },
                              underline: { type: 'boolean' },
                              code: { type: 'boolean' },
                            },
                            required: ['bold', 'italic', 'underline', 'code'],
                          },
                        },
                        required: ['kind', 'url', 'text', 'marks'],
                      },
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: { kind: { type: 'string', enum: ['br'] } },
                        required: ['kind'],
                      },
                    ],
                  },
                },
              },
              required: ['kind', 'align', 'inlines'],
            },
            {
              // List
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['list'] },
                listType: { type: 'string', enum: ['bullet', 'number'] },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      indent: { type: 'number', enum: [0, 1] },
                      blocks: {
                        type: 'array',
                        items: {
                          anyOf: [
                            {
                              // paragraph inside list item (reuse shape inline)
                              type: 'object',
                              additionalProperties: false,
                              properties: {
                                kind: { type: 'string', enum: ['paragraph'] },
                                align: { type: 'string', enum: ['start', 'center', 'right'] },
                                inlines: {
                                  type: 'array',
                                  items: {
                                    anyOf: [
                                      {
                                        type: 'object',
                                        additionalProperties: false,
                                        properties: {
                                          kind: { type: 'string', enum: ['text'] },
                                          text: { type: 'string' },
                                          marks: {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                              bold: { type: 'boolean' },
                                              italic: { type: 'boolean' },
                                              underline: { type: 'boolean' },
                                              code: { type: 'boolean' },
                                            },
                                            required: ['bold', 'italic', 'underline', 'code'],
                                          },
                                        },
                                        required: ['kind', 'text', 'marks'],
                                      },
                                      {
                                        type: 'object',
                                        additionalProperties: false,
                                        properties: {
                                          kind: { type: 'string', enum: ['link'] },
                                          url: { type: 'string' },
                                          text: { type: 'string' },
                                          marks: {
                                            type: 'object',
                                            additionalProperties: false,
                                            properties: {
                                              bold: { type: 'boolean' },
                                              italic: { type: 'boolean' },
                                              underline: { type: 'boolean' },
                                              code: { type: 'boolean' },
                                            },
                                            required: ['bold', 'italic', 'underline', 'code'],
                                          },
                                        },
                                        required: ['kind', 'url', 'text', 'marks'],
                                      },
                                      {
                                        type: 'object',
                                        additionalProperties: false,
                                        properties: { kind: { type: 'string', enum: ['br'] } },
                                        required: ['kind'],
                                      },
                                    ],
                                  },
                                },
                              },
                              required: ['kind', 'align', 'inlines'],
                            },
                          ],
                        },
                      },
                    },
                    required: ['indent', 'blocks'],
                  },
                },
              },
              required: ['kind', 'listType', 'items'],
            },
            {
              // Quote
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['quote'] },
                blocks: {
                  type: 'array',
                  items: {
                    anyOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          kind: { type: 'string', enum: ['paragraph'] },
                          align: { type: 'string', enum: ['start', 'center', 'right'] },
                          inlines: {
                            type: 'array',
                            items: {
                              anyOf: [
                                {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: {
                                    kind: { type: 'string', enum: ['text'] },
                                    text: { type: 'string' },
                                    marks: {
                                      type: 'object',
                                      additionalProperties: false,
                                      properties: {
                                        bold: { type: 'boolean' },
                                        italic: { type: 'boolean' },
                                        underline: { type: 'boolean' },
                                        code: { type: 'boolean' },
                                      },
                                      required: ['bold', 'italic', 'underline', 'code'],
                                    },
                                  },
                                  required: ['kind', 'text', 'marks'],
                                },
                                {
                                  type: 'object',
                                  additionalProperties: false,
                                  properties: { kind: { type: 'string', enum: ['br'] } },
                                  required: ['kind'],
                                },
                              ],
                            },
                          },
                        },
                        required: ['kind', 'align', 'inlines'],
                      },
                    ],
                  },
                },
              },
              required: ['kind', 'blocks'],
            },
            {
              // Horizontal rule
              type: 'object',
              additionalProperties: false,
              properties: { kind: { type: 'string', enum: ['hr'] } },
              required: ['kind'],
            },
          ],
        },
      },
    },
    required: ['title', 'blocks'],
  },
} as const
