import { readFileSync } from 'node:fs'

import mysql from 'mysql2/promise'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { assertTestDatabase } from '../src/lib/test-db.js'

const script = readFileSync(
  new URL('../sql/0006_add-sign-in-rate-limits.sql', import.meta.url),
  'utf8'
)
  .replaceAll('byline_admin_sign_in_rate_limits', 'byline_sign_in_fixture')
  .replaceAll('idx_admin_sign_in_rate_limits_expiry', 'idx_sign_in_fixture_expiry')
let client: mysql.Connection
beforeAll(async () => {
  const connectionString = process.env.BYLINE_DB_MYSQL_CONNECTION_STRING
  assertTestDatabase(connectionString)
  client = await mysql.createConnection(connectionString!)
  await client.query('DROP TABLE IF EXISTS byline_sign_in_fixture')
})
afterAll(async () => {
  if (client) {
    await client.query('DROP TABLE IF EXISTS byline_sign_in_fixture')
    await client.end()
  }
})
it('native upgrade creates the Drizzle shape and reruns without resetting counters', async () => {
  await client.query(script)
  await client.query("INSERT INTO byline_sign_in_fixture VALUES ('test', 7, '2030-01-01')")
  await client.query(script)
  expect((await client.query('SELECT attempts FROM byline_sign_in_fixture'))[0]).toEqual([
    { attempts: 7 },
  ])
  const columns = async (table: string) =>
    (
      await client.query(
        `SELECT column_name, data_type, character_maximum_length, datetime_precision, is_nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`,
        [table]
      )
    )[0]
  expect(await columns('byline_sign_in_fixture')).toEqual(
    await columns('byline_admin_sign_in_rate_limits')
  )
  const [indexes] = await client.query<mysql.RowDataPacket[]>(
    "SHOW INDEX FROM byline_sign_in_fixture WHERE Key_name='idx_sign_in_fixture_expiry'"
  )
  expect(indexes).toHaveLength(1)
})
