/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { randomUUID } from 'node:crypto'

import type { AdminPreferencesRepository } from '@byline/admin/admin-preferences'
import { eq, inArray } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { adminUserPreferences, adminUsers } from '../../../database/schema/auth.js'
import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'
import { createAdminPreferencesRepository } from '../admin-preferences-repository.js'
import type * as schema from '../../../database/schema/index.js'

const SCOPE = 'collections.docs.list'

describe('admin-preferences repository (integration)', () => {
  let db: NodePgDatabase<typeof schema>
  let repo: AdminPreferencesRepository
  const createdUserIds = new Set<string>()

  async function createUser(): Promise<string> {
    const id = randomUUID()
    await db.insert(adminUsers).values({
      id,
      email: `pref-test-${id}@example.test`,
      password: '$argon2id$test-not-a-real-hash',
      is_enabled: true,
    })
    createdUserIds.add(id)
    return id
  }

  beforeAll(async () => {
    const testDB = setupTestDB([])
    db = testDB.db
    repo = createAdminPreferencesRepository(db)
  })

  afterEach(async () => {
    if (createdUserIds.size > 0) {
      await db.delete(adminUsers).where(inArray(adminUsers.id, [...createdUserIds]))
      createdUserIds.clear()
    }
  })

  afterAll(async () => {
    await teardownTestDB()
  })

  it('returns null for a missing (user, scope) row', async () => {
    const userId = await createUser()
    expect(await repo.get(userId, SCOPE)).toBeNull()
  })

  it('inserts on first upsert and reads the value back', async () => {
    const userId = await createUser()
    const row = await repo.upsert(userId, SCOPE, { page_size: 50 })
    expect(row.user_id).toBe(userId)
    expect(row.scope).toBe(SCOPE)
    expect(row.value).toEqual({ page_size: 50 })

    const read = await repo.get(userId, SCOPE)
    expect(read?.value).toEqual({ page_size: 50 })
  })

  it('merges per key on conflict — page_size write preserves a stored sort', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { order: 'title', desc: true })
    const merged = await repo.upsert(userId, SCOPE, { page_size: 30 })
    expect(merged.value).toEqual({ order: 'title', desc: true, page_size: 30 })
  })

  it('overwrites the same key on conflict (last writer wins per key)', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { page_size: 15 })
    const updated = await repo.upsert(userId, SCOPE, { page_size: 100 })
    expect(updated.value).toEqual({ page_size: 100 })
  })

  it('keeps scopes independent for the same user', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { page_size: 50 })
    await repo.upsert(userId, 'collections.media.list', { page_size: 15 })
    expect((await repo.get(userId, SCOPE))?.value).toEqual({ page_size: 50 })
    expect((await repo.get(userId, 'collections.media.list'))?.value).toEqual({ page_size: 15 })
  })

  it('cascade-deletes preference rows with the user', async () => {
    const userId = await createUser()
    await repo.upsert(userId, SCOPE, { page_size: 50 })
    await db.delete(adminUsers).where(eq(adminUsers.id, userId))
    createdUserIds.delete(userId)
    const orphans = await db
      .select()
      .from(adminUserPreferences)
      .where(eq(adminUserPreferences.user_id, userId))
    expect(orphans).toHaveLength(0)
  })
})
