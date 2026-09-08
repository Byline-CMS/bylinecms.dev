import { readFileSync } from 'node:fs'

import type { AdminStore } from '@byline/admin'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { v7 as uuidv7 } from 'uuid'
import { afterAll, beforeAll, expect, it } from 'vitest'

import * as schema from '../src/database/schema/index.js'
import { assertTestDatabase } from '../src/lib/test-db.js'
import { createAdminStore } from '../src/modules/admin/admin-store.js'

let client: pg.Client
let store: AdminStore
const query = async (sql: string) => (await client.query(sql)).rows
beforeAll(async () => {
  const connectionString = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING
  assertTestDatabase(connectionString)
  client = new pg.Client({ connectionString })
  await client.connect()
  store = createAdminStore(drizzle(client, { schema }))
})
afterAll(async () => {
  await client?.end()
})
const installFailure = async () => {
  await query(
    `CREATE OR REPLACE FUNCTION byline_test_revoke_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected revocation failure'; END $$`
  )
  await query(
    'CREATE TRIGGER byline_test_revoke_failure BEFORE UPDATE ON byline_admin_refresh_tokens FOR EACH ROW EXECUTE FUNCTION byline_test_revoke_failure()'
  )
}
const clearFailure = async () => {
  await query('DROP TRIGGER IF EXISTS byline_test_revoke_failure ON byline_admin_refresh_tokens')
  await query('DROP FUNCTION IF EXISTS byline_test_revoke_failure()')
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
    new URL('../sql/0012_add-session-generations.sql', import.meta.url),
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
