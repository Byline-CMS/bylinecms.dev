/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { documentPaths, documentPublishSchedules } from './index.js'

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

describe('schema pins — scheduled publication', () => {
  const cfg = getTableConfig(documentPublishSchedules)

  it('pins one row per document and exactly the three lifecycle ownership foreign keys', () => {
    const documentId = cfg.columns.find((column) => column.name === 'document_id')
    expect(documentId?.primary).toBe(true)

    const references = cfg.foreignKeys.map((foreignKey) => ({
      local: foreignKey.reference().columns.map((column) => column.name),
      foreignTable: getTableName(foreignKey.reference().foreignTable),
      onDelete: foreignKey.onDelete,
    }))
    expect(references).toEqual([
      {
        local: ['document_id'],
        foreignTable: 'byline_documents',
        onDelete: 'cascade',
      },
      {
        local: ['collection_id'],
        foreignTable: 'byline_collections',
        onDelete: 'cascade',
      },
      {
        local: ['target_version_id'],
        foreignTable: 'byline_document_versions',
        onDelete: 'cascade',
      },
    ])
  })

  it('pins the bounded state and suspension-reason constraints', () => {
    expect(cfg.checks.map((constraint) => constraint.name).sort()).toEqual([
      'check_document_publish_schedules_state',
      'check_document_publish_schedules_suspended_reason',
    ])
  })

  it('pins the armed-only due index and execution-expiry recovery index', () => {
    const due = cfg.indexes.find(
      (candidate) => candidate.config.name === 'idx_document_publish_schedules_due'
    )
    expect(due?.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual([
      'next_attempt_at',
      'publish_at',
    ])
    expect(due?.config.where).toBeDefined()

    const expiry = cfg.indexes.find(
      (candidate) => candidate.config.name === 'idx_document_publish_schedules_execution_expiry'
    )
    expect(expiry?.config.columns.map((column) => ('name' in column ? column.name : null))).toEqual(
      ['execution_expires_at']
    )
  })

  it('pins microsecond, timezone-aware storage for every schedule instant', () => {
    const instantNames = [
      'publish_at',
      'suspended_at',
      'last_authorized_at',
      'scheduled_at',
      'updated_at',
      'execution_expires_at',
      'last_attempt_at',
      'next_attempt_at',
    ]
    for (const name of instantNames) {
      const column = cfg.columns.find((candidate) => candidate.name === name)
      expect(column?.getSQLType(), name).toBe('timestamp (6) with time zone')
    }
  })
})
