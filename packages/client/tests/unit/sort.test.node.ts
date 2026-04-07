/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveSortSpec } from '../../src/collection-handle.js'

describe('resolveSortSpec', () => {
  it('should default to created_at desc when no sort provided', () => {
    expect(resolveSortSpec()).toEqual({ order: 'created_at', desc: true })
  })

  it('should default to created_at desc for empty object', () => {
    expect(resolveSortSpec({})).toEqual({ order: 'created_at', desc: true })
  })

  it('should map camelCase createdAt to created_at', () => {
    expect(resolveSortSpec({ createdAt: 'asc' })).toEqual({ order: 'created_at', desc: false })
  })

  it('should map camelCase updatedAt to updated_at', () => {
    expect(resolveSortSpec({ updatedAt: 'desc' })).toEqual({ order: 'updated_at', desc: true })
  })

  it('should pass through path as-is', () => {
    expect(resolveSortSpec({ path: 'asc' })).toEqual({ order: 'path', desc: false })
  })

  it('should accept snake_case column names', () => {
    expect(resolveSortSpec({ created_at: 'asc' })).toEqual({ order: 'created_at', desc: false })
  })

  it('should fall back to created_at for unknown field names', () => {
    expect(resolveSortSpec({ title: 'desc' })).toEqual({ order: 'created_at', desc: true })
  })
})
