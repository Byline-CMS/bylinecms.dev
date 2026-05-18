/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createHash } from 'node:crypto'

import type { ICounterCommands } from '@byline/core'
import { eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { counterGroups } from '../../database/schema/index.js'
import type * as schema from '../../database/schema/index.js'

type DatabaseConnection = NodePgDatabase<typeof schema>

/**
 * Derive a stable, safe Postgres identifier for the sequence backing a
 * counter group.
 *
 * Two competing goals: humans browsing the database should be able to
 * recognise which group a sequence belongs to, and the name must never
 * collide for two different group strings. We satisfy both by combining
 * a sanitised slug of the group name with an 8-character SHA-256 prefix
 * — so `'library-facets'` becomes something like
 * `byline_cseq_library_facets_8c2f4d6a`.
 *
 * Postgres identifier limit is 63 bytes (NAMEDATALEN-1). The prefix is
 * 12 bytes, the hash + underscore is 9, leaving 42 bytes for the slug.
 */
function deriveSequenceName(groupName: string): string {
  const slug = groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42)
  const hash = createHash('sha256').update(groupName).digest('hex').slice(0, 8)
  return slug ? `byline_cseq_${slug}_${hash}` : `byline_cseq_${hash}`
}

export class CounterCommands implements ICounterCommands {
  constructor(private db: DatabaseConnection) {}

  async ensureCounterGroup(
    groupName: string
  ): Promise<{ groupName: string; sequenceName: string }> {
    if (!groupName || typeof groupName !== 'string') {
      throw new Error(`ensureCounterGroup: groupName must be a non-empty string`)
    }

    const sequenceName = deriveSequenceName(groupName)

    // Two statements, both idempotent. We deliberately do not wrap them
    // in a single transaction: CREATE SEQUENCE acquires its own catalog
    // locks, and DDL inside a long-running INSERT can deadlock under
    // concurrent boots. Splitting them keeps each step short.
    //
    // The sequence is created first so that even if the INSERT loses a
    // race, the next caller's nextval() on the existing row's
    // sequence_name still works.
    await this.db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS "${sequenceName}" AS BIGINT`))

    await this.db
      .insert(counterGroups)
      .values({ group_name: groupName, sequence_name: sequenceName })
      .onConflictDoNothing({ target: counterGroups.group_name })

    return { groupName, sequenceName }
  }

  async nextCounterValue(groupName: string): Promise<number> {
    if (!groupName || typeof groupName !== 'string') {
      throw new Error(`nextCounterValue: groupName must be a non-empty string`)
    }

    // Resolve the sequence name from the registry rather than re-deriving
    // it. This keeps callers honest — if the group was never registered
    // via ensureCounterGroup, we surface that immediately rather than
    // silently creating a new sequence the first time a value is asked
    // for (which would mask configuration bugs during boot).
    const rows = await this.db
      .select({ sequence_name: counterGroups.sequence_name })
      .from(counterGroups)
      .where(eq(counterGroups.group_name, groupName))
      .limit(1)

    if (rows.length === 0) {
      throw new Error(
        `nextCounterValue: counter group "${groupName}" is not registered. ` +
          `Call ensureCounterGroup at boot before any document create that uses it.`
      )
    }

    const sequenceName = rows[0]!.sequence_name

    // sql.raw is safe here: sequenceName came from our own registry row,
    // which was written by ensureCounterGroup from deriveSequenceName
    // — only [a-z0-9_] characters, no user-controlled SQL.
    const result = await this.db.execute(sql.raw(`SELECT nextval('"${sequenceName}"') AS value`))

    // Drizzle/node-postgres returns rows on result.rows; the value comes
    // back as a string because pg's BIGINT default is string. Parse it —
    // counter values that overflow Number.MAX_SAFE_INTEGER are not a
    // realistic concern for the facet-URL use case (we'd run out of
    // useful URL space long before).
    const row = (result.rows as Array<{ value: string | number }>)[0]
    if (row === undefined) {
      throw new Error(`nextCounterValue: nextval returned no row for group "${groupName}"`)
    }
    return typeof row.value === 'number' ? row.value : Number(row.value)
  }
}

export function createCounterCommands(db: DatabaseConnection): ICounterCommands {
  return new CounterCommands(db)
}
