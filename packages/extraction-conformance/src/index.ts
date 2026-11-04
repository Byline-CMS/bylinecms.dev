/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, it } from 'vitest'

import { type ConformanceHooks, extractionProviderConformanceCases, loadFixtures } from './cases.js'

export {
  ConformanceFailure,
  type ConformanceFixtures,
  type ConformanceHooks,
  type ExtractionProviderConformanceCase,
  extractionProviderConformanceCases,
  loadFixtures,
  SENTINELS,
} from './cases.js'

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Registers the extraction provider conformance cases with Vitest. Call it at the top
 * level of a test file.
 *
 * OCR, tables, formulas and charts are declared by the author and are not verified. The
 * page map sentinel case is the only provenance claim the kit makes.
 *
 * @provisional
 */
export function defineExtractionProviderConformance(hooks: ConformanceHooks): void {
  describe(`${hooks.name} extraction provider conformance`, () => {
    const fixtures = loadFixtures()
    for (const { id, name, run } of extractionProviderConformanceCases) {
      it(
        `case ${id}: ${name}`,
        async (context) => {
          const outcome = await run(hooks, fixtures)
          if (outcome !== undefined) context.skip(outcome.skipped)
        },
        hooks.timeoutMs ?? DEFAULT_TIMEOUT_MS
      )
    }
  })
}
