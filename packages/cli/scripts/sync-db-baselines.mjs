import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = resolve(cliRoot, '..')
const targetRoot = resolve(cliRoot, 'src/templates/migrations')

const adapters = {
  postgres: 'db-postgres',
  mysql: 'db-mysql',
}

const baselines = Object.entries(adapters).map(([dialect, packageDirectory]) => {
  const source = resolve(packagesRoot, packageDirectory, 'src/database/migrations')
  const sqlFiles = readdirSync(source)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  if (sqlFiles.length !== 1) {
    throw new Error(
      `${packageDirectory} must contain exactly one squashed SQL migration; found ${sqlFiles.length}`
    )
  }

  const journalPath = resolve(source, 'meta/_journal.json')
  const journalText = readFileSync(journalPath, 'utf8')
  const journal = JSON.parse(journalText)
  if (!Array.isArray(journal.entries) || journal.entries.length !== 1) {
    throw new Error(
      `${packageDirectory} migration journal must contain exactly one entry; found ${
        Array.isArray(journal.entries) ? journal.entries.length : 'an invalid entries value'
      }`
    )
  }

  const sqlName = sqlFiles[0]
  const expectedTag = sqlName.slice(0, -'.sql'.length)
  if (journal.entries[0]?.tag !== expectedTag) {
    throw new Error(
      `${packageDirectory} journal tag "${String(
        journal.entries[0]?.tag
      )}" does not match migration "${expectedTag}"`
    )
  }

  return {
    dialect,
    sourceSql: resolve(source, sqlName),
    sqlName,
    journalPath,
  }
})

rmSync(targetRoot, { recursive: true, force: true })

for (const baseline of baselines) {
  const target = resolve(targetRoot, baseline.dialect)
  mkdirSync(resolve(target, 'meta'), { recursive: true })
  copyFileSync(baseline.sourceSql, resolve(target, baseline.sqlName))
  copyFileSync(baseline.journalPath, resolve(target, 'meta/_journal.json'))
  console.log(`synced ${baseline.dialect}: ${baseline.sqlName}`)
}
