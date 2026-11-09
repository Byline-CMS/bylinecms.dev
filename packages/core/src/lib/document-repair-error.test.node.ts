/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { ERR_DATABASE, ERR_VALIDATION, getDocumentRepairRequiredDetails } from './errors.js'

describe('repair-required errors', () => {
  it('accepts live errors and serialized reports, returning only the public reason', () => {
    const error = ERR_VALIDATION({
      message: 'Private detail',
      details: { reason: 'stored_content_requires_repair', warnings: ['private content'] },
      cause: new Error('Private cause'),
    })
    for (const input of [error, error.report()]) {
      expect(getDocumentRepairRequiredDetails(input)).toEqual({
        reason: 'stored_content_requires_repair',
      })
    }
  })

  it('does not classify other failures or infer the reason from messages', () => {
    for (const error of [
      null,
      new Error('stored_content_requires_repair'),
      ERR_VALIDATION({ message: 'stored_content_requires_repair' }),
      ERR_VALIDATION({ message: 'Invalid', details: { reason: 'invalid_document_fields' } }),
      ERR_DATABASE({ message: 'Failed', details: { reason: 'stored_content_requires_repair' } }),
      {
        get code() {
          throw new Error('Unreadable property')
        },
      },
    ]) {
      expect(getDocumentRepairRequiredDetails(error)).toBeNull()
    }
  })
})
