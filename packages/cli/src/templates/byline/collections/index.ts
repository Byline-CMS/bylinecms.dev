/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { InferCollectionRegistry } from '@byline/core'

/** Add schema-only collection imports here; keep admin presentation separate. */
export const collections = [] as const

export type BylineCollections = InferCollectionRegistry<typeof collections>
