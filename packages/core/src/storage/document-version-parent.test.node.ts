/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { ErrorCodes } from '../lib/errors.js'
import { assertDocumentVersionParent } from './document-version-parent.js'

describe('assertDocumentVersionParent', () => {
  it.each([
    { label: 'the first version', locale: 'en', currentVersionId: null },
    { label: "an existing locale: 'all' write", locale: 'all', currentVersionId: 'ver-current' },
    { label: 'an existing locale-less full-tree write', currentVersionId: 'ver-current' },
  ])('allows an omitted parent for $label', ({ locale, currentVersionId }) => {
    expect(() =>
      assertDocumentVersionParent({ documentId: 'doc-1', locale, currentVersionId })
    ).not.toThrow()
  })

  it('allows the current parent for a locale-scoped write', () => {
    expect(() =>
      assertDocumentVersionParent({
        documentId: 'doc-1',
        locale: 'fr',
        previousVersionId: 'ver-current',
        currentVersionId: 'ver-current',
      })
    ).not.toThrow()
  })

  it('classifies an omitted locale-scoped parent as missing', () => {
    expect(() =>
      assertDocumentVersionParent({
        documentId: 'doc-1',
        locale: 'fr',
        currentVersionId: 'ver-current',
      })
    ).toThrowError(
      expect.objectContaining({
        code: ErrorCodes.CONFLICT,
        message: 'previous document version is required for a locale-scoped write',
        details: {
          reason: 'missing',
          documentId: 'doc-1',
          previousVersionId: null,
          currentVersionId: 'ver-current',
        },
      })
    )
  })

  it.each(['fr', 'all', undefined])(
    'classifies a mismatched parent as stale for locale %s',
    (locale) => {
      expect(() =>
        assertDocumentVersionParent({
          documentId: 'doc-1',
          locale,
          previousVersionId: 'ver-stale',
          currentVersionId: 'ver-current',
        })
      ).toThrowError(
        expect.objectContaining({
          code: ErrorCodes.CONFLICT,
          message: 'previous document version is stale',
          details: {
            reason: 'stale',
            documentId: 'doc-1',
            previousVersionId: 'ver-stale',
            currentVersionId: 'ver-current',
          },
        })
      )
    }
  )
})
