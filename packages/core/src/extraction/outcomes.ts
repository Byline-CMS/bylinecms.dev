/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  EligibilityUpdateOutcome,
  ExclusionState,
  ProjectionOutcome,
} from '../@types/extraction-types.js'

/**
 * Derives whether ineligible text has left search. Reporting surfaces must not
 * compute this any other way. `projection` is the outcome of the first write
 * attempted after the eligibility update.
 *
 * When the eligibility update failed, the join still includes the old text, so a
 * successful search write leaves it searchable. That case is reported as pending,
 * never as excluded.
 *
 * @provisional
 */
export function exclusionState(
  eligibility: EligibilityUpdateOutcome,
  projection: ProjectionOutcome | undefined
): ExclusionState {
  if (eligibility.kind === 'not-required') return { state: 'not-required' }
  if (eligibility.kind === 'failed') {
    return { state: 'pending', reason: 'eligibility-update-failed' }
  }
  if (projection === undefined) return { state: 'pending', reason: 'not-attempted' }
  return projection.kind === 'written'
    ? { state: 'excluded' }
    : { state: 'pending', reason: projection.reason }
}
