/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Deep-serialise a value through JSON to convert Date objects to ISO strings.
 * TanStack Start server functions pass return values directly during SSR
 * (no automatic JSON round-trip), so Date instances from the DB driver would
 * fail downstream Zod z.string() checks without this explicit step.
 */
export function serialise<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
