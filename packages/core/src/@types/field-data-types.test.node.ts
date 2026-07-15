import { File } from 'node:buffer'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { defineCollection } from './collection-types.js'
import { createPendingStoredFileValue } from './field-data-types.js'
import type { CollectionFieldData, CollectionFieldDataAllLocales } from './collection-types.js'
import type {
  PopulatedRelationValue,
  RelatedDocumentValue,
  RelationFieldReadValue,
  RelationReadValue,
} from './relation-types.js'

const RelationShapes = defineCollection({
  path: 'relation-shapes',
  labels: { singular: 'Relation shape', plural: 'Relation shapes' },
  fields: [
    { name: 'single', type: 'relation', targetCollection: 'people' },
    { name: 'many', type: 'relation', targetCollection: 'people', hasMany: true },
    {
      name: 'group',
      type: 'group',
      fields: [
        { name: 'single', type: 'relation', targetCollection: 'people' },
        { name: 'many', type: 'relation', targetCollection: 'people', hasMany: true },
      ],
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'single', type: 'relation', targetCollection: 'people' },
        { name: 'many', type: 'relation', targetCollection: 'people', hasMany: true },
      ],
    },
    {
      name: 'content',
      type: 'blocks',
      blocks: [
        {
          blockType: 'relations',
          fields: [
            { name: 'single', type: 'relation', targetCollection: 'people' },
            { name: 'many', type: 'relation', targetCollection: 'people', hasMany: true },
          ],
        },
      ],
    },
    { name: 'localizedTitle', type: 'text', localized: true },
  ],
})

describe('field data contracts', () => {
  it('infers single and hasMany relations through nested structures', () => {
    type Fields = CollectionFieldData<typeof RelationShapes>
    type AllLocales = CollectionFieldDataAllLocales<typeof RelationShapes>
    type Block = Fields['content'][number]
    type AllLocalesBlock = AllLocales['content'][number]

    expectTypeOf<Fields['single']>().toEqualTypeOf<RelatedDocumentValue>()
    expectTypeOf<Fields['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<Fields['group']['single']>().toEqualTypeOf<RelatedDocumentValue>()
    expectTypeOf<Fields['group']['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<Fields['items'][number]['single']>().toEqualTypeOf<RelatedDocumentValue>()
    expectTypeOf<Fields['items'][number]['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<Block['single']>().toEqualTypeOf<RelatedDocumentValue>()
    expectTypeOf<Block['many']>().toEqualTypeOf<RelatedDocumentValue[]>()

    expectTypeOf<AllLocales['single']>().toEqualTypeOf<RelatedDocumentValue>()
    expectTypeOf<AllLocales['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<AllLocales['group']['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<AllLocales['items'][number]['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<AllLocalesBlock['many']>().toEqualTypeOf<RelatedDocumentValue[]>()
    expectTypeOf<AllLocales['localizedTitle']>().toEqualTypeOf<Record<string, string>>()
  })

  it('keeps a pending file size numeric', () => {
    const pending = createPendingStoredFileValue(
      new File(['content'], 'fixture.txt', { type: 'text/plain' }),
      'blob:fixture'
    )

    expect(pending.fileSize).toBe(7)
    expectTypeOf(pending.fileSize).toEqualTypeOf<number>()
  })

  it('exposes generic single and hasMany relation read envelopes', () => {
    type PersonDocument = { fields: { name: string } }

    expectTypeOf<
      PopulatedRelationValue<PersonDocument>['document']
    >().toEqualTypeOf<PersonDocument>()
    expectTypeOf<RelationFieldReadValue<false, PersonDocument>>().toEqualTypeOf<
      RelationReadValue<PersonDocument>
    >()
    expectTypeOf<RelationFieldReadValue<true, PersonDocument>>().toEqualTypeOf<
      RelationReadValue<PersonDocument>[]
    >()
  })
})
