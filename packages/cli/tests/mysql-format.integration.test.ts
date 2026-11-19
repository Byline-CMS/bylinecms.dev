import { randomBytes } from 'node:crypto'

import { inspectCoreStorage, verifyCatalogFormat } from '@byline/db-mysql/migrations'
import { type Connection, createConnection } from 'mysql2/promise'
import { expect, it } from 'vitest'

import { loadBaseline } from '../../db-mysql/dist/migrations/assets.js'
import { rows } from '../../db-mysql/dist/migrations/catalog.js'
import { installOnConnection } from '../../db-mysql/dist/migrations/runner.js'
import { withMysqlTarget } from './mysql-target.js'

it('admits an unlisted patch with a matching live fingerprint and refuses a different format before the lock', async () =>
  withMysqlTarget(async (url) => {
    const connection = await createConnection(url.href)
    let denyVisibility = true
    let changeFormat = true
    const statements: string[] = []
    // Only substitute the reported version and one SHOW CREATE result. Every
    // temporary table, rejected insert, journal and baseline stage runs on MySQL.
    const wrapped = new Proxy(connection, {
      get(target, key) {
        if (key !== 'query') return Reflect.get(target, key, target)
        return async (sql: string, values?: unknown[]) => {
          statements.push(sql)
          if (
            denyVisibility &&
            sql.startsWith('SHOW CREATE TABLE') &&
            sql.includes('byline_fmt_')
          ) {
            throw Object.assign(Error('SHOW CREATE denied'), { errno: 1142 })
          }
          const result = await target.query(sql, values)
          if (sql.includes('VERSION() AS version'))
            (result[0] as { version: string }[])[0]!.version = '8.4.999'
          if (changeFormat && sql.startsWith('SHOW CREATE TABLE') && sql.includes('byline_fmt_')) {
            const r = (result[0] as { 'Create Table': string }[])[0]!
            r['Create Table'] = r['Create Table'].replace('zerofill', 'changed-format')
          }
          return result
        }
      },
    }) as Connection
    try {
      await expect(installOnConnection(wrapped, loadBaseline())).rejects.toThrow(
        /inaccessible: MySQL denied access/
      )
      expect(statements.some((sql) => sql.includes('GET_LOCK'))).toBe(false)
      expect(await rows(connection, 'SHOW TABLES')).toHaveLength(0)
      denyVisibility = false
      await expect(installOnConnection(wrapped, loadBaseline())).rejects.toThrow(
        /unsupported-engine/
      )
      expect(statements.some((sql) => sql.includes('GET_LOCK'))).toBe(false)
      expect(await rows(connection, 'SHOW TABLES')).toHaveLength(0)
      changeFormat = false
      expect(await installOnConnection(wrapped, loadBaseline())).toMatchObject({
        version: 10,
        changed: true,
      })
    } finally {
      await connection.end()
    }
  }))

it('keeps status read-only for an inspection role without CREATE TEMPORARY TABLES', async () =>
  withMysqlTarget(async (url, admin, name) => {
    const user = `byline_observer_${randomBytes(4).toString('hex')}`,
      password = randomBytes(16).toString('hex')
    await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [password])
    try {
      await admin.query(`GRANT SELECT,SHOW VIEW,TRIGGER ON \`${name}\`.* TO '${user}'@'%'`)
      const observer = new URL(url)
      observer.username = user
      observer.password = password
      expect(await inspectCoreStorage(observer.href)).toMatchObject({
        state: 'empty',
        formatNote: expect.stringContaining('Read-only'),
      })
      const connection = await createConnection(observer.href)
      try {
        await expect(verifyCatalogFormat(connection)).rejects.toThrow(/CREATE TEMPORARY TABLES/)
      } finally {
        await connection.end()
      }
    } finally {
      await admin.query(`DROP USER IF EXISTS '${user}'@'%'`)
    }
  }))
