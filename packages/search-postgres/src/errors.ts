/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export class SearchAnalyzerMismatchError extends Error {
  readonly code = 'SEARCH_INDEX_REINDEX_REQUIRED'

  constructor(
    readonly collectionPath: string,
    readonly expectedFingerprint: string,
    readonly actualFingerprint: string | null
  ) {
    const actual = actualFingerprint ?? 'an unversioned analyzer'
    super(
      `Search index for collection "${collectionPath}" uses "${actual}"; ` +
        `expected analyzer "${expectedFingerprint}". Rebuild this collection's search index.`
    )
    this.name = 'SearchAnalyzerMismatchError'
  }
}
