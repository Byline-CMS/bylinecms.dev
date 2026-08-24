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

describe('embedded analytics migrations', () => {
  const sqlFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  it('embeds exactly the SQL files that ship', () => {
    expect(MIGRATIONS.map((migration) => migration.name).sort()).toEqual(sqlFiles)
  })

  it.each(sqlFiles)('matches %s byte-for-byte after trimming', (name) => {
    const embedded = MIGRATIONS.find((migration) => migration.name === name)
    expect(embedded?.sql.trim()).toBe(readFileSync(join(migrationsDir, name), 'utf8').trim())
  })

  it('derives every version from its filename', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.version).toBe(Number.parseInt(migration.name.split('_')[0] ?? '', 10))
    }
  })
})
