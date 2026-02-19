/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { IDbAdapter } from '@byline/core'

import { createCommandBuilders } from './storage/storage-commands.js'
import { createQueryBuilders } from './storage/storage-queries.js'

export const remoteAdapter = ({ apiUrl }: { apiUrl: string }): IDbAdapter => {
  const commandBuilders = createCommandBuilders(null)
  const queryBuilders = createQueryBuilders(null)

  // @ts-expect-error
  return { commands: commandBuilders, queries: queryBuilders }
}
