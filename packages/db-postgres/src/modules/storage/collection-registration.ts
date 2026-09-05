/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ERR_DATABASE, ERR_NOT_FOUND, ERR_VALIDATION } from '@byline/core'
import { sql } from 'drizzle-orm'

import type { DBManager } from '../../lib/db-manager.js'

export async function lockCollectionRegistration(
  dbManager: DBManager,
  collectionId: string,
  mode: 'shared' | 'exclusive'
): Promise<void> {
  if (mode !== 'shared' && mode !== 'exclusive') {
    throw ERR_VALIDATION({ message: 'Invalid collection registration lock mode' })
  }
  if (!dbManager.isInTransaction()) {
    throw ERR_DATABASE({
      message: 'collection registration locks require an active transaction',
      details: { collectionId },
    })
  }

  const locked = await dbManager.get().execute(sql`
      SELECT id FROM byline_collections
      WHERE id = ${collectionId}::uuid
      ${mode === 'exclusive' ? sql`FOR UPDATE` : sql`FOR KEY SHARE`}
    `)
  if (locked.rows.length === 0) {
    throw ERR_NOT_FOUND({
      message: 'collection registration not found',
      details: { collectionId },
    })
  }
}
