/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type DbErrorClassification, DbErrorCodes } from '@byline/core'
import { describe, expect, it } from 'vitest'

/**
 * One adapter's contribution to the shared `classifyError` contract matrix
 * (carry-forward from the #45 review). Each canonical adapter (db-postgres,
 * db-mysql) wires this from its own `.test.node.ts` file, passing its own
 * `classifyError` and a realistic driver error representing the *same*
 * logical failure: a duplicate-key collision on the
 * `idx_document_paths_collection_locale_path` unique index/constraint
 * (each adapter's `src/database/schema/index.ts`). Running every adapter's case
 * through one shared assertion set is what keeps the two classifiers from
 * silently drifting apart — the whole point of the `classifyError` seam is
 * that core never learns driver anatomy, which only holds if every adapter
 * reports the same shape for the same failure.
 *
 * Foreign-key violations share the same seam because ownership constraints
 * must also be observable without leaking driver-specific error anatomy into
 * core or shared adapter tests.
 */
export interface ClassifyErrorContractCase {
  /** Short label for the `describe` block, e.g. 'postgres' / 'mysql'. */
  adapterName: string
  classifyError: (err: unknown) => DbErrorClassification
  /**
   * A realistic driver error for a duplicate-key collision on
   * `idx_document_paths_collection_locale_path`, with no `cause` chain —
   * the raw driver error shape as it would surface directly.
   */
  uniqueViolationError: unknown
  /**
   * The same failure, nested inside a Drizzle-style `cause` chain
   * (`DrizzleQueryError` wrapping the driver error) — the shape
   * `classifyError` actually receives in production.
   */
  nestedUniqueViolationError: unknown
  /** A foreign-key violation nested inside a Drizzle-style `cause` chain. */
  foreignKeyViolationError: unknown
  /** A realistic but unrelated driver error outside the classified families. */
  unrelatedError: unknown
}

/**
 * Run the shared `classifyError` contract against every case supplied.
 * No database required — every input is a synthetic driver-error fixture.
 */
export function runClassifyErrorContract(cases: ClassifyErrorContractCase[]): void {
  describe.each(cases)(
    'classifyError contract ($adapterName)',
    ({
      classifyError,
      uniqueViolationError,
      nestedUniqueViolationError,
      foreignKeyViolationError,
      unrelatedError,
    }) => {
      it('classifies a unique violation with the bare index name', () => {
        expect(classifyError(uniqueViolationError)).toEqual({
          code: DbErrorCodes.UNIQUE_VIOLATION,
          constraint: 'idx_document_paths_collection_locale_path',
        })
      })

      it('classifies a unique violation nested inside a Drizzle-style cause chain', () => {
        expect(classifyError(nestedUniqueViolationError)).toEqual({
          code: DbErrorCodes.UNIQUE_VIOLATION,
          constraint: 'idx_document_paths_collection_locale_path',
        })
      })

      it('classifies a foreign-key violation with the bare constraint name', () => {
        expect(classifyError(foreignKeyViolationError)).toEqual({
          code: DbErrorCodes.FOREIGN_KEY_VIOLATION,
          constraint: 'fk_document_owner',
        })
      })

      it('classifies an unrelated error as UNKNOWN', () => {
        expect(classifyError(unrelatedError)).toEqual({ code: DbErrorCodes.UNKNOWN })
      })

      it('does not throw on a non-Error value', () => {
        expect(() => classifyError(null)).not.toThrow()
        expect(() => classifyError('boom')).not.toThrow()
        expect(classifyError(null)).toEqual({ code: DbErrorCodes.UNKNOWN })
        expect(classifyError('boom')).toEqual({ code: DbErrorCodes.UNKNOWN })
      })
    }
  )
}
