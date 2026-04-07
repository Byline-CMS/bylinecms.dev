/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { shapeDocument } from '../../src/response.js'

describe('shapeDocument', () => {
  it('should map snake_case document to camelCase ClientDocument', () => {
    const raw = {
      document_id: 'doc-1',
      document_version_id: 'ver-1',
      path: 'hello-world',
      status: 'published',
      created_at: new Date('2026-01-15T10:00:00Z'),
      updated_at: new Date('2026-02-20T14:30:00Z'),
      fields: { title: 'Hello World', summary: 'A test document.' },
    }

    const result = shapeDocument(raw)

    expect(result.id).toBe('doc-1')
    expect(result.versionId).toBe('ver-1')
    expect(result.path).toBe('hello-world')
    expect(result.status).toBe('published')
    expect(result.createdAt).toEqual(new Date('2026-01-15T10:00:00Z'))
    expect(result.updatedAt).toEqual(new Date('2026-02-20T14:30:00Z'))
    expect(result.fields).toEqual({ title: 'Hello World', summary: 'A test document.' })
  })

  it('should handle missing fields with sensible defaults', () => {
    const result = shapeDocument({})

    expect(result.id).toBe('')
    expect(result.versionId).toBe('')
    expect(result.path).toBe('')
    expect(result.status).toBe('')
    expect(result.fields).toEqual({})
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.updatedAt).toBeInstanceOf(Date)
  })

  it('should coerce string dates to Date objects', () => {
    const raw = {
      document_id: 'doc-1',
      document_version_id: 'ver-1',
      created_at: '2026-03-10T08:00:00Z',
      updated_at: '2026-03-10T09:00:00Z',
    }

    const result = shapeDocument(raw)

    expect(result.createdAt).toEqual(new Date('2026-03-10T08:00:00Z'))
    expect(result.updatedAt).toEqual(new Date('2026-03-10T09:00:00Z'))
  })
})
