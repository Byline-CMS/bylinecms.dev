/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveItemViewColumns } from './config.js'
import type { CollectionAdminConfig, ColumnDefinition } from '../@types/index.js'

const itemViewCols: ColumnDefinition[] = [{ fieldName: 'title', label: 'Title' }]
const pickerCols: ColumnDefinition[] = [{ fieldName: 'name', label: 'Name' }]

const cfg = (over: Partial<CollectionAdminConfig>): CollectionAdminConfig =>
  ({ slug: 'x', ...over }) as CollectionAdminConfig

describe('resolveItemViewColumns', () => {
  it('returns itemView when present', () => {
    expect(resolveItemViewColumns(cfg({ itemView: itemViewCols }))).toBe(itemViewCols)
  })

  it('falls back to the deprecated picker alias', () => {
    expect(resolveItemViewColumns(cfg({ picker: pickerCols }))).toBe(pickerCols)
  })

  it('prefers itemView over picker when both are present', () => {
    expect(resolveItemViewColumns(cfg({ itemView: itemViewCols, picker: pickerCols }))).toBe(
      itemViewCols
    )
  })

  it('returns undefined when neither is set', () => {
    expect(resolveItemViewColumns(cfg({}))).toBeUndefined()
  })

  it('tolerates null / undefined config', () => {
    expect(resolveItemViewColumns(null)).toBeUndefined()
    expect(resolveItemViewColumns(undefined)).toBeUndefined()
  })
})
