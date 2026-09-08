import { readFileSync } from 'node:fs'

import type { AdminStore } from '@byline/admin'
import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, expect, it } from 'vitest'

import * as schema from '../src/database/schema/index.js'
import { assertTestDatabase } from '../src/lib/test-db.js'
import { createAdminStore } from '../src/modules/admin/admin-store.js'

let client: mysql.Connection
let store: AdminStore
const query = async (sql: string) => (await client.query(sql))[0]
beforeAll(async () => {
  const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
  assertTestDatabase(connectionString)
  client = await mysql.createConnection({ uri: connectionString, multipleStatements: true })
  store = createAdminStore(drizzle(client, { schema, mode: 'default' }))
})
afterAll(async () => {
  await client?.end()
})
const installFailure = async () => {
  await query(
    'ALTER TABLE byline_admin_refresh_tokens ADD CONSTRAINT byline_test_no_revoke CHECK (revoked_at IS NULL)'
  )
}
const clearFailure = async () => {
  await query('ALTER TABLE byline_admin_refresh_tokens DROP CHECK byline_test_no_revoke')
}

it.each(['password', 'disable', 'update-disable'])(
  'rolls back %s when the refresh revocation SQL fails',
  async (operation) => {
    const user = await store.adminUsers.create({
      email: `${uuidv7()}@example.test`,
      password_hash: 'original',
      is_enabled: true,
    })
    const token = await store.refreshTokens.issue({
      id: uuidv7(),
      admin_user_id: user.id,
      token_hash: uuidv7(),
      session_version: 0,
      expires_at: new Date(Date.now() + 60000),
    })
    await installFailure()
    try {
      const mutation =
        operation === 'password'
          ? store.adminUsers.setPasswordHash(user.id, user.vid, 'replacement')
          : operation === 'disable'
            ? store.adminUsers.setEnabled(user.id, false)
            : store.adminUsers.update(user.id, user.vid, { is_enabled: false })
      await expect(mutation).rejects.toThrow()
    } finally {
      await clearFailure()
    }
    const fresh = await store.adminUsers.getByIdForSignIn(user.id)
    expect(fresh).toMatchObject({
      password_hash: 'original',
      session_version: 0,
      vid: user.vid,
      is_enabled: true,
    })
    expect((await store.refreshTokens.findById(token.id))?.revoked_at).toBeNull()
  }
)

it('native generation migration defaults legacy rows and preserves current generations on rerun', async () => {
  const script = readFileSync(
    new URL('../sql/0007_add-session-generations.sql', import.meta.url),
    'utf8'
  )
    .replaceAll('byline_admin_users', 'byline_session_user_fixture')
    .replaceAll('byline_admin_refresh_tokens', 'byline_session_refresh_fixture')
  await query('CREATE TABLE byline_session_user_fixture (id integer PRIMARY KEY)')
  await query('CREATE TABLE byline_session_refresh_fixture (id integer PRIMARY KEY)')
  try {
    await query('INSERT INTO byline_session_user_fixture VALUES (1)')
    await query('INSERT INTO byline_session_refresh_fixture VALUES (1)')
    await query(script)
    expect(await query('SELECT session_version FROM byline_session_user_fixture')).toEqual([
      { session_version: 0 },
    ])
    expect(await query('SELECT session_version FROM byline_session_refresh_fixture')).toEqual([
      { session_version: -1 },
    ])
    await query('UPDATE byline_session_user_fixture SET session_version = 7')
    await query('UPDATE byline_session_refresh_fixture SET session_version = 7')
    await query(script)
    expect(await query('SELECT session_version FROM byline_session_user_fixture')).toEqual([
      { session_version: 7 },
    ])
    expect(await query('SELECT session_version FROM byline_session_refresh_fixture')).toEqual([
      { session_version: 7 },
    ])
  } finally {
    await query('DROP TABLE byline_session_refresh_fixture')
    await query('DROP TABLE byline_session_user_fixture')
  }
})
