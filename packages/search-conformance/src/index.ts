/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SearchProvider } from '@byline/core'
import type { PortableSearchAnalyzer } from '@byline/search-analysis'
import { afterAll, beforeAll } from 'vitest'

import { capabilitiesSuite } from './suites/capabilities.js'
import { fullTextMatchingSuite } from './suites/full-text-matching.js'
import { lifecycleSuite } from './suites/lifecycle.js'
import { portableAnalysisSuite } from './suites/portable-analysis.js'

export { capabilitiesSuite } from './suites/capabilities.js'
export { fullTextMatchingSuite } from './suites/full-text-matching.js'
export { lifecycleSuite } from './suites/lifecycle.js'
export { portableAnalysisSuite } from './suites/portable-analysis.js'

/**
 * Adapter-owned operations needed to run the shared behavioral suites against
 * one real backend. Implementations should reuse one connection pool across
 * provider instances and close it in `teardown`.
 */
export interface SearchConformanceHooks {
  /** Construct the adapter with its ordinary production defaults. */
  createProvider(): SearchProvider | Promise<SearchProvider>
  /**
   * Construct the adapter with an explicit portable analyzer. Supply this
   * only when `capabilities.fullText.portableAnalysis` is true; doing so
   * registers the portable parser/fingerprint suites.
   */
  createPortableProvider?(
    analyzer: PortableSearchAnalyzer
  ): SearchProvider | Promise<SearchProvider>
  /** Bring the adapter-owned search schema to its current version. */
  migrate(): Promise<void>
  /** Clear every derived search row while retaining the schema. */
  reset(): Promise<void>
  /** Close backend connections. */
  teardown(): Promise<void>
}

/**
 * Register the complete Byline search-provider conformance suite. Named suite
 * exports let an adapter port register smaller phases while it is incomplete;
 * a completed adapter should use this aggregate runner.
 */
export function runSearchProviderConformanceSuite(hooks: SearchConformanceHooks): void {
  beforeAll(async () => {
    await hooks.migrate()
  })

  afterAll(async () => {
    try {
      await hooks.reset()
    } finally {
      await hooks.teardown()
    }
  })

  capabilitiesSuite(hooks)
  lifecycleSuite(hooks)
  fullTextMatchingSuite(hooks)
  portableAnalysisSuite(hooks)
}
