import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { baselineDir } from './baseline.js'
import type { DbDialect } from '../types.js'

const here = dirname(fileURLToPath(import.meta.url))
const templates = resolve(here, '../templates')
const packages = resolve(here, '../../..')
const fixtures: string[] = []

const adapterSources: Record<DbDialect, string> = {
  postgres: resolve(packages, 'db-postgres/src/database/migrations'),
  mysql: resolve(packages, 'db-mysql/src/database/migrations'),
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe.each<DbDialect>(['postgres', 'mysql'])('bundled %s baseline', (dialect) => {
  it('matches the adapter source as one complete runtime migration', () => {
    expect(() =>
      assertBaselineContract(adapterSources[dialect], baselineDir(templates, dialect))
    ).not.toThrow()
  })
})

it('rejects a partial bundle when the source contains a second migration', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'byline-baseline-drift-'))
  fixtures.push(root)
  const source = resolve(root, 'source')
  const bundled = resolve(root, 'bundled')
  mkdirSync(resolve(source, 'meta'), { recursive: true })
  mkdirSync(resolve(bundled, 'meta'), { recursive: true })
  writeFileSync(resolve(source, '0000_baseline.sql'), 'select 1;\n')
  writeFileSync(resolve(source, '0001_delta.sql'), 'select 2;\n')
  writeFileSync(resolve(bundled, '0000_baseline.sql'), 'select 1;\n')
  const journal = `${JSON.stringify({
    entries: [{ tag: '0000_baseline' }, { tag: '0001_delta' }],
  })}\n`
  writeFileSync(resolve(source, 'meta/_journal.json'), journal)
  writeFileSync(resolve(bundled, 'meta/_journal.json'), journal)

  expect(() => assertBaselineContract(source, bundled)).toThrow(
    'source must contain exactly one SQL migration'
  )
})

function assertBaselineContract(source: string, bundled: string): void {
  const sourceSql = sqlFiles(source)
  const bundledSql = sqlFiles(bundled)
  if (sourceSql.length !== 1) {
    throw new Error(`source must contain exactly one SQL migration; found ${sourceSql.length}`)
  }
  if (bundledSql.length !== 1) {
    throw new Error(`bundle must contain exactly one SQL migration; found ${bundledSql.length}`)
  }
  if (JSON.stringify(sourceSql) !== JSON.stringify(bundledSql)) {
    throw new Error(
      `source and bundle SQL inventories differ: ${sourceSql.join(', ')} != ${bundledSql.join(', ')}`
    )
  }
  const sqlName = sourceSql[0]
  if (!sqlName) throw new Error('source SQL inventory unexpectedly became empty')

  const expectedInventory = [sqlName, 'meta/_journal.json'].sort()
  const bundledInventory = fileInventory(bundled)
  if (JSON.stringify(bundledInventory) !== JSON.stringify(expectedInventory)) {
    throw new Error(
      `bundle inventory differs: ${bundledInventory.join(', ')} != ${expectedInventory.join(', ')}`
    )
  }

  const sourceJournal = readFileSync(resolve(source, 'meta/_journal.json'), 'utf8')
  const bundledJournal = readFileSync(resolve(bundled, 'meta/_journal.json'), 'utf8')
  if (sourceJournal !== bundledJournal) throw new Error('source and bundle journals differ')

  const journal = JSON.parse(sourceJournal) as { entries?: Array<{ tag?: string }> }
  if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
    throw new Error('journal must contain exactly one entry')
  }
  const expectedTag = sqlName.slice(0, -'.sql'.length)
  if (journal.entries[0]?.tag !== expectedTag) {
    throw new Error(`journal tag does not match SQL migration: ${journal.entries[0]?.tag}`)
  }

  const sourceSqlText = readFileSync(resolve(source, sqlName), 'utf8')
  const bundledSqlText = readFileSync(resolve(bundled, sqlName), 'utf8')
  if (sourceSqlText !== bundledSqlText) throw new Error('source and bundle SQL differ')
}

function sqlFiles(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

function fileInventory(root: string): string[] {
  const files: string[] = []
  function walk(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  walk(root)
  return files.sort()
}
