/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Storage round-trip for `hasMany` relations — an ordered list of relation
 * values flattens to indexed `store_relation` rows (`<field>.0`, `<field>.1`,
 * …) and reconstructs back into the same ordered array. Pure functions; no
 * Postgres needed.
 */

import { defineCollection } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { flattenFieldSetData } from '../storage-flatten.js'
import { restoreFieldSetData } from '../storage-restore.js'

const Articles = defineCollection({
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'authors',
      type: 'relation',
      targetCollection: 'people',
      hasMany: true,
      optional: true,
    },
    // A required hasMany to exercise the empty-list fixup.
    {
      name: 'tags',
      type: 'relation',
      targetCollection: 'tags',
      hasMany: true,
    },
  ],
})

const Single = defineCollection({
  path: 'single',
  labels: { singular: 'Single', plural: 'Singles' },
  fields: [{ name: 'lead', type: 'relation', targetCollection: 'people', optional: true }],
})

describe('hasMany relation storage round-trip', () => {
  it('flattens an ordered list to indexed relation rows', () => {
    const flat = flattenFieldSetData(
      Articles.fields,
      {
        title: 'Hello',
        authors: [
          { targetDocumentId: 'a1', targetCollectionId: 'people' },
          { targetDocumentId: 'a2', targetCollectionId: 'people' },
          { targetDocumentId: 'a3', targetCollectionId: 'people' },
        ],
        tags: [],
      },
      'all'
    )

    const relRows = flat.filter((r) => r.field_type === 'relation')
    expect(relRows.map((r) => r.field_path.join('.'))).toEqual([
      'authors.0',
      'authors.1',
      'authors.2',
    ])
    // Relations are non-localized — every row carries locale 'all'.
    expect(relRows.every((r) => r.locale === 'all')).toBe(true)
  })

  it('reconstructs the ordered array (and preserves order)', () => {
    const data = {
      title: 'Hello',
      authors: [
        { targetDocumentId: 'a3', targetCollectionId: 'people' },
        { targetDocumentId: 'a1', targetCollectionId: 'people' },
        { targetDocumentId: 'a2', targetCollectionId: 'people' },
      ],
      tags: [{ targetDocumentId: 't1', targetCollectionId: 'tags' }],
    }
    const { data: restored, warnings } = restoreFieldSetData(
      Articles.fields,
      flattenFieldSetData(Articles.fields, data, 'all')
    )
    expect(warnings).toEqual([])
    expect(restored.authors.map((a: any) => a.targetDocumentId)).toEqual(['a3', 'a1', 'a2'])
    expect(restored.authors[0]).toMatchObject({
      targetDocumentId: 'a3',
      targetCollectionId: 'people',
    })
    expect(restored.tags.map((t: any) => t.targetDocumentId)).toEqual(['t1'])
  })

  it('reconstructs a required empty hasMany as []', () => {
    const { data: restored } = restoreFieldSetData(
      Articles.fields,
      flattenFieldSetData(Articles.fields, { title: 'x', authors: [], tags: [] }, 'all')
    )
    expect(restored.tags).toEqual([])
  })

  it('leaves single (non-hasMany) relations as scalar values', () => {
    const { data: restored } = restoreFieldSetData(
      Single.fields,
      flattenFieldSetData(
        Single.fields,
        { lead: { targetDocumentId: 'p1', targetCollectionId: 'people' } },
        'all'
      )
    )
    expect(Array.isArray(restored.lead)).toBe(false)
    expect(restored.lead).toMatchObject({ targetDocumentId: 'p1', targetCollectionId: 'people' })
  })
})
