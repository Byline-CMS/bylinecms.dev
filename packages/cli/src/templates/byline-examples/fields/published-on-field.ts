/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { defineField, type FieldData } from '@byline/core'

/**
 * Common "published on" datetime field. Defined once via `defineField`
 * so the literal `name: 'publishedOn'` and `type: 'datetime'` survive
 * inference, and dropped into any collection that needs a publish
 * timestamp.
 */
export const publishedOnField = defineField({
  name: 'publishedOn',
  label: 'Published On',
  type: 'datetime',
  mode: 'datetime',
})

/** Data shape contributed by `publishedOnField` (resolves to `Date`). */
export type PublishedOnFieldData = FieldData<typeof publishedOnField>
