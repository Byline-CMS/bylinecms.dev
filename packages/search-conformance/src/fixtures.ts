/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchDocument, SearchField } from '@byline/core'

let sequence = 0

export function searchDocument(
  text: string,
  overrides: Partial<SearchDocument> = {}
): SearchDocument {
  sequence += 1
  const documentId = overrides.documentId ?? `search-conformance-${sequence}`
  return {
    collectionPath: 'search-conformance',
    documentId,
    locale: 'en',
    status: 'published',
    zones: ['search-conformance'],
    title: text,
    path: documentId,
    fields: [bodyField(text)],
    updatedAt: new Date(1_700_000_000_000 + sequence).toISOString(),
    ...overrides,
  }
}

export function bodyField(text: string, boost?: number): SearchField {
  return {
    name: 'body',
    type: 'text',
    role: 'body',
    value: text,
    ...(boost == null ? {} : { boost }),
  }
}
