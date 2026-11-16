/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import {
  buildRelationProjections,
  buildRelationSummaryPopulateMap,
  type RelationTargetResolver,
} from './relation-projection.js'
import type { CollectionAdminConfig, CollectionDefinition, FieldSet } from '../@types/index.js'

const media = {
  path: 'media',
  labels: { singular: 'Media', plural: 'Media' },
  useAsTitle: 'title',
  fields: [
    { name: 'title', type: 'text' },
    { name: 'image', type: 'image' },
    { name: 'credit', type: 'text' },
  ],
} as unknown as CollectionDefinition

const mediaAdmin = {
  path: 'media',
  itemView: [
    { fieldName: 'image', label: 'Preview' },
    { fieldName: 'title', label: 'Title' },
    { fieldName: 'status', label: 'Status' },
  ],
} as unknown as CollectionAdminConfig

const sourceFields = [
  { name: 'photo', type: 'relation', targetCollection: 'media' },
  {
    name: 'content',
    type: 'blocks',
    blocks: [
      {
        blockType: 'photoBlock',
        fields: [{ name: 'gallery', type: 'relation', targetCollection: 'media' }],
      },
    ],
  },
] as unknown as FieldSet

/** The client runtime: both the schema and the admin config are registered. */
const withAdmin: RelationTargetResolver = (path) => ({
  def: path === 'media' ? media : null,
  admin: path === 'media' ? mediaAdmin : null,
})

/** A server runtime that has not yet loaded the admin config. */
const withoutAdmin: RelationTargetResolver = (path) => ({
  def: path === 'media' ? media : null,
  admin: null,
})

describe('buildRelationProjections', () => {
  it('lists the target fields each relation tile needs, keyed by relation field name', () => {
    expect(buildRelationProjections(sourceFields, withAdmin)).toEqual({
      photo: ['title', 'image'],
      gallery: ['title', 'image'],
    })
  })
})

describe('buildRelationSummaryPopulateMap', () => {
  it('omits item-view fields when the admin config is absent and nothing is requested', () => {
    // The failing boundary: a server runtime without the admin config
    // projects only schema-derived fields, so the media thumbnail is lost.
    expect(buildRelationSummaryPopulateMap(sourceFields, withoutAdmin)).toEqual({
      photo: { select: ['title'] },
      gallery: { select: ['title'] },
    })
  })

  it('keeps caller-requested fields when the admin config is absent', () => {
    const requested = buildRelationProjections(sourceFields, withAdmin)
    expect(buildRelationSummaryPopulateMap(sourceFields, withoutAdmin, requested)).toEqual({
      photo: { select: ['title', 'image'] },
      gallery: { select: ['title', 'image'] },
    })
  })

  it('drops requested names that are not fields on the target schema', () => {
    const map = buildRelationSummaryPopulateMap(sourceFields, withoutAdmin, {
      photo: ['image', 'status', 'not_a_field', '__proto__'],
    })
    expect(map.photo).toEqual({ select: ['title', 'image'] })
  })

  it('ignores requests for relation names the source schema does not declare', () => {
    const map = buildRelationSummaryPopulateMap(sourceFields, withoutAdmin, {
      unknown: ['image'],
    })
    expect(Object.keys(map).sort()).toEqual(['gallery', 'photo'])
  })

  it('ignores malformed request entries', () => {
    const map = buildRelationSummaryPopulateMap(sourceFields, withoutAdmin, {
      photo: 'image' as unknown as string[],
      gallery: [42 as unknown as string, 'image'],
    })
    expect(map).toEqual({
      photo: { select: ['title'] },
      gallery: { select: ['title', 'image'] },
    })
  })
})
