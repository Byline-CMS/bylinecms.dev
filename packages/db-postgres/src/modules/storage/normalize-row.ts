/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { UnifiedFieldValue } from '@byline/core'

/**
 * Canonicalise a raw UNION ALL driver row to the shared UnifiedFieldValue
 * contract. For pg this codifies current behaviour (identity for most
 * columns): BIGINT file_size may arrive as string (tolerated by the type),
 * numeric/decimal arrives as string, timestamptz arrives as Date.
 * The MySQL adapter's counterpart absorbs tinyint(1)→boolean etc.
 */
export function normalizeRow(row: Record<string, unknown>): UnifiedFieldValue {
  return row as unknown as UnifiedFieldValue
}
