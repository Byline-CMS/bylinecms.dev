import { randomBytes } from 'node:crypto'

import { type Connection, createConnection } from 'mysql2/promise'

import { rows } from '../../db-mysql/dist/migrations/catalog.js'

export async function withMysqlTarget(
  work: (url: URL, admin: Connection, name: string) => Promise<void>
) {
  const url = new URL(process.env.BYLINE_CLI_MYSQL_ADMIN_URL ?? '')
  if (url.protocol !== 'mysql:' || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('MySQL migration fixtures require a loopback test server')
  const connection = await createConnection(url.href)
  const name = `byline_cli_recovery_${randomBytes(5).toString('hex')}_test`
  try {
    await connection.query(
      `CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    )
    url.pathname = name
    console.info('MySQL fixture', name, (await rows(connection, 'SELECT VERSION() AS v'))[0]?.v)
    await work(url, connection, name)
  } finally {
    await connection.query(`DROP DATABASE IF EXISTS ${name}`)
    await connection.end()
  }
}
