/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DATABASE, getLogger } from '@byline/core'

// ------------------------------------------------------------------------------
// Misc
//
// `resolveStoreTypes` lives in `@byline/core` (`packages/core/src/storage/
// storage-utils.ts`) — it is dialect-independent. `getFirstOrThrow` stays
// here: it's a result helper tied to this adapter. Mirrors
// `packages/db-postgres/src/modules/storage/storage-utils.ts`.
// ------------------------------------------------------------------------------

export const getFirstOrThrow =
  <T>(message: string) =>
  (values: T[]): T => {
    const value = values[0]
    if (value == null) {
      throw ERR_DATABASE({ message }).log(getLogger())
    }
    return value
  }
