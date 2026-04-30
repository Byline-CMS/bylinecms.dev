/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Small chrome-internal utilities. Inlined here so the package doesn't
 * pull in host-app helpers from `@/utils/utils.general.ts`.
 */

export function formatNumber(value: number, decimalPlaces = 0): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError('Input must be a valid number')
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  })
}
