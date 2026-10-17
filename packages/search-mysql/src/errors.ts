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
    const actual = actualFingerprint == null ? 'an unversioned analyzer' : `"${actualFingerprint}"`
    super(
      `Search index for collection "${collectionPath}" uses ${actual}; ` +
        `this process expects analyzer "${expectedFingerprint}". ` +
        "First align this process's Node.js/ICU version and analyzer configuration with the serving application. " +
        'The built-in portable analyzer includes process.versions.icu in its fingerprint. ' +
        'If an analyzer change is intentional or the index is unversioned, rebuild this collection ' +
        'from the serving environment with the analyzer that will serve queries. ' +
        'Do not rebuild a shared index from a mismatched workstation or import process.'
    )
    this.name = 'SearchAnalyzerMismatchError'
  }
}
