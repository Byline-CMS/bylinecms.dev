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
    super(
      `Search index for collection "${collectionPath}" uses analyzer fingerprint ` +
        `"${actualFingerprint ?? '(missing)'}", but "${expectedFingerprint}" is configured. ` +
        'Clear and rebuild this collection before searching or indexing it.'
    )
    this.name = 'SearchAnalyzerMismatchError'
  }
}
