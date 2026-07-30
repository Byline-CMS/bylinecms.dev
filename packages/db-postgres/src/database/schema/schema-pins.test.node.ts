/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { documentPaths } from './index.js'

describe('schema pins — document-path liveness', () => {
  it('pins the live-path and document-locale unique keys', () => {
    const cfg = getTableConfig(documentPaths)
    const pathKey = cfg.uniqueConstraints.find(
      (constraint) => constraint.name === 'idx_document_paths_collection_locale_path'
    )
    expect(pathKey?.columns.map((column) => column.name)).toEqual([
      'collection_id',
      'locale',
      'path',
      'alive',
    ])

    const documentLocaleKey = cfg.uniqueConstraints.find(
      (constraint) => constraint.name === 'unique_document_paths_document_locale'
    )
    expect(documentLocaleKey?.columns.map((column) => column.name)).toEqual([
      'document_id',
      'locale',
    ])
  })

  it('pins nullable deleted_at and the stored generated alive discriminator', () => {
    const cfg = getTableConfig(documentPaths)
    const deletedAt = cfg.columns.find((column) => column.name === 'deleted_at')
    const alive = cfg.columns.find((column) => column.name === 'alive')

    expect(deletedAt?.getSQLType()).toBe('timestamp (6) with time zone')
    expect(deletedAt?.notNull).toBe(false)
    expect(alive?.getSQLType()).toBe('boolean')
    expect(alive?.notNull).toBe(false)
    expect(alive?.generated).toMatchObject({ type: 'always', mode: 'stored' })
  })
})
