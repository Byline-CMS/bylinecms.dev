/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionAdminConfig, Field, GroupDefinition, RowDefinition } from '@byline/core'
import { describe, expect, it } from 'vitest'

import { buildFieldToTabPath } from './use-form-layout'

const field = (name: string): Field => ({ name, type: 'text', label: name }) as Field

const fieldNames = ['title', 'body', 'seoTitle', 'seoDesc', 'note']
const fieldByName = new Map<string, Field>(fieldNames.map((n) => [n, field(n)]))

const rowByName = new Map<string, RowDefinition>([
  ['seoRow', { name: 'seoRow', fields: ['seoTitle', 'seoDesc'] }],
])
const groupByName = new Map<string, GroupDefinition>([
  ['seoGroup', { name: 'seoGroup', label: 'SEO', fields: ['seoRow'] }],
])

describe('buildFieldToTabPath', () => {
  it('returns an empty map when there are no tab sets', () => {
    const map = buildFieldToTabPath(undefined, fieldByName, rowByName, groupByName)
    expect(map.size).toBe(0)
  })

  it('maps direct fields to their tab set + tab', () => {
    const adminConfig = {
      tabSets: [
        {
          name: 'main',
          tabs: [
            { name: 'content', label: 'Content', fields: ['title', 'body'] },
            { name: 'meta', label: 'Meta', fields: ['note'] },
          ],
        },
      ],
    } as unknown as CollectionAdminConfig

    const map = buildFieldToTabPath(adminConfig, fieldByName, rowByName, groupByName)
    expect(map.get('title')).toEqual({ tabSetName: 'main', tabName: 'content' })
    expect(map.get('body')).toEqual({ tabSetName: 'main', tabName: 'content' })
    expect(map.get('note')).toEqual({ tabSetName: 'main', tabName: 'meta' })
  })

  it('recurses through rows and groups to reach nested fields', () => {
    const adminConfig = {
      tabSets: [
        {
          name: 'main',
          tabs: [{ name: 'seo', label: 'SEO', fields: ['seoGroup'] }],
        },
      ],
    } as unknown as CollectionAdminConfig

    const map = buildFieldToTabPath(adminConfig, fieldByName, rowByName, groupByName)
    // seoGroup → seoRow → [seoTitle, seoDesc]
    expect(map.get('seoTitle')).toEqual({ tabSetName: 'main', tabName: 'seo' })
    expect(map.get('seoDesc')).toEqual({ tabSetName: 'main', tabName: 'seo' })
    // Container names themselves are not fields, so are not indexed.
    expect(map.has('seoGroup')).toBe(false)
    expect(map.has('seoRow')).toBe(false)
  })

  it('does not loop forever on a self-referential row cycle', () => {
    const cyclicRows = new Map<string, RowDefinition>([
      ['loop', { name: 'loop', fields: ['loop', 'title'] }],
    ])
    const adminConfig = {
      tabSets: [{ name: 'main', tabs: [{ name: 't', label: 'T', fields: ['loop'] }] }],
    } as unknown as CollectionAdminConfig

    const map = buildFieldToTabPath(adminConfig, fieldByName, cyclicRows, groupByName)
    // The cycle guard stops the re-visit; the real field is still indexed.
    expect(map.get('title')).toEqual({ tabSetName: 'main', tabName: 't' })
  })
})
