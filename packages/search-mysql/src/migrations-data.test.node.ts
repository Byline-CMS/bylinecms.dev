/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MIGRATIONS } from './migrations-data.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations')

describe('embedded migrations vs the .sql files', () => {
  const sqlFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  it('embeds exactly the .sql files that ship in the package', () => {
    expect(MIGRATIONS.map((migration) => migration.name).sort()).toEqual(sqlFiles)
  })

  it.each(sqlFiles)('embedded SQL for %s matches the file on disk', (name) => {
    const onDisk = readFileSync(join(migrationsDir, name), 'utf8')
    const embedded = MIGRATIONS.find((migration) => migration.name === name)
    expect(embedded, `no embedded migration named ${name}`).toBeDefined()
    expect(embedded?.sql.trim()).toBe(onDisk.trim())
  })

  it('numbers each migration from its filename prefix', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.version).toBe(Number.parseInt(migration.name.split('_')[0] ?? '', 10))
    }
  })
})
