import { randomBytes } from 'node:crypto'

import { escapeId } from 'mysql2'
import type { Connection } from 'mysql2/promise'

import { assertMySqlVersion } from '../lib/boot-check.js'
import { assertDefinition, definition, rows } from './catalog.js'
import { readPrivileges } from './privileges.js'

/** The same normalizer is used for the probe and every durable stage. */
export async function verifyCatalogFormat(connection: Connection) {
  const [session] = await rows(connection, 'SELECT DATABASE() AS db, VERSION() AS version')
  await assertMySqlVersion(async () => [{ v: session?.version }])
  const database = session?.db
  if (!database) throw Error('Select a MySQL database before migration preflight.')
  const has = await readPrivileges(connection, database)
  if (!has(undefined, 'CREATE TEMPORARY TABLES'))
    throw Error(
      `inaccessible: MySQL format preflight requires CREATE TEMPORARY TABLES on ${database}; grant it to the migration account or an active role.`
    )
  const name = `byline_fmt_${randomBytes(8).toString('hex')}`
  const id = escapeId(name)
  const check = escapeId(`${name}_check`)
  let created = false
  try {
    await connection.query(`CREATE TEMPORARY TABLE ${id} (
      ordinal INT NOT NULL, big_value BIGINT UNSIGNED NOT NULL, padded INT(8) UNSIGNED ZEROFILL NOT NULL,
      optional_value INT NULL,
      live TINYINT(1) GENERATED ALWAYS AS (CASE WHEN optional_value IS NULL THEN TRUE ELSE FALSE END) STORED,
      UNIQUE KEY probe_key(ordinal,big_value),
      CONSTRAINT ${check} CHECK (live IN (TRUE,FALSE) AND big_value > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
    created = true
    const expected = [
      `CREATE TEMPORARY TABLE ${id} (`,
      'column 1 `ordinal` int NOT NULL',
      'column 2 `big_value` bigint unsigned NOT NULL',
      'column 3 `padded` int(8) unsigned zerofill NOT NULL',
      'column 4 `optional_value` int DEFAULT NULL',
      'column 5 `live` tinyint(1) GENERATED ALWAYS AS ((case when (`optional_value` is null) then true else false end)) STORED',
      'UNIQUE KEY `probe_key` (`ordinal`,`big_value`)',
      `CONSTRAINT ${check} CHECK (((\`live\` in (true,false)) and (\`big_value\` > 0)))`,
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
    ]
    assertDefinition(
      'temporary MySQL catalog probe',
      expected,
      await definition(connection, database, name)
    )
    try {
      await connection.query(`INSERT INTO ${id}(ordinal,big_value,padded) VALUES(1,0,1)`)
    } catch (error) {
      if ((error as { errno?: number }).errno === 3819) return
      throw error
    }
    throw Error('Expected an enforced CHECK to reject the probe row')
  } catch (error) {
    if ([1044, 1142, 1143, 1227].includes((error as { errno?: number }).errno ?? 0))
      throw Error(
        `inaccessible: MySQL denied access to the temporary catalog probe on ${database}. Verify the migration account's grants and active roles.`,
        { cause: error }
      )
    throw Error(
      `unsupported-engine: MySQL ${session.version} did not match the core migration catalog format. ${(error as Error).message}`
    )
  } finally {
    if (created) await connection.query(`DROP TEMPORARY TABLE ${id}`)
  }
}
