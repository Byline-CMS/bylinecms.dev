/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { validateDocumentWriteInput } from './document-write-input.js'

describe('document write request shapes', () => {
  it.each([null, {}, { collection: 'pages', data: [] }, { collection: 42, data: {} }])(
    'rejects malformed create requests: %j',
    (input) => {
      expect(() => validateDocumentWriteInput(input, 'create')).toThrow(
        'Invalid document write request'
      )
    }
  )
  it.each([
    null,
    [null],
    [{ kind: 'field.set', path: 'title[' }],
    [{ kind: 'array.move', path: 'items', itemId: 'a', toIndex: -1 }],
    [{ kind: 'unknown', path: 'title' }],
  ])('rejects malformed patches: %j', (patches) => {
    expect(() =>
      validateDocumentWriteInput({ collection: 'pages', id: 'doc', patches }, 'patch')
    ).toThrow()
  })
  it('accepts nested patches and leaves revision checks to their dedicated contract', () => {
    const input = {
      collection: 'pages',
      id: 'doc',
      patches: [
        {
          kind: 'array.updateItem',
          path: 'items',
          itemId: 'a',
          patches: [{ kind: 'field.set', path: 'title', value: 'Hello' }],
        },
      ],
    }
    expect(validateDocumentWriteInput(input, 'patch')).toBe(input)
  })
})
