/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Normalise known date-like fields to `Date` instances before persisting.
 *
 * Mutates the input record in-place for performance.
 * Currently handles `created_at`, `updated_at`, and `publishedOn`.
 */
export function normaliseDateFields(data: Record<string, any>): void {
  if (typeof data.created_at === 'string') data.created_at = new Date(data.created_at)
  if (typeof data.updated_at === 'string') data.updated_at = new Date(data.updated_at)
  if (typeof data.publishedOn === 'string') data.publishedOn = new Date(data.publishedOn)
}
