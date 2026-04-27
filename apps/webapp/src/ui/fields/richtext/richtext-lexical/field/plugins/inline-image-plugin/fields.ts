/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SelectValue } from '@infonomic/uikit/react'

export const positionOptions: SelectValue[] = [
  { label: 'Left', value: 'left' },
  { label: 'Right', value: 'right' },
  { label: 'Full', value: 'full' },
  { label: 'Wide', value: 'wide' },
]

/** Alt text is required for accessibility — non-empty after trimming. */
export function isAltTextValid(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
