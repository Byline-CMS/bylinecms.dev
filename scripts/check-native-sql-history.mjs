import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

// Every package that owns an independent numbered migration stream, not just
// the database adapters. Each such runner records which *versions* it applied,
// never their content, so amending a released file changes what a fresh
// database gets while leaving every existing one untouched — two databases
// then report the same version with different schemas. That is not theoretical:
// `search-postgres/migrations/0001_init.sql` was amended in 4.9.0 to add the
// `analyzer_fingerprint` column and the `byline_search_index_metadata` table,
// and because this pattern watched only `packages/db-*/sql/`, nothing objected.
// Installations first booted on 3.15.0–4.8.0 could never receive either, and
// writing to the index failed until `0002_analyzer_fingerprint` repaired them.
//
// Deliberately excluded: `packages/db-*/src/database/migrations/` and
// `packages/cli/src/templates/migrations/`. Those hold Drizzle's single
// squashed baseline, which is *meant* to be rewritten; `sync:baselines` and
// `baseline-drift.test.ts` are the gates that govern them.
const SQL_HISTORY_PATTERN = /^packages\/[^/]+\/(?:sql|migrations)\/[^/]+\.sql$/
const NUMBERED_SQL = /^\d{4}_.+\.sql$/

const base = readOption('--base')
if (!base) {
  fail('usage: node scripts/check-native-sql-history.mjs --base <previous-release-ref>')
}

git(['rev-parse', '--verify', `${base}^{commit}`])

const taggedFiles = git(['ls-tree', '-r', '--name-only', base, '--', 'packages'])
  .toString('utf8')
  .split('\n')
  .filter((path) => SQL_HISTORY_PATTERN.test(path) && NUMBERED_SQL.test(basename(path)))
  .sort()

const errors = []
for (const path of taggedFiles) {
  if (!existsSync(path)) {
    errors.push(`${path}: deleted after ${base}`)
    continue
  }

  const tagged = git(['show', `${base}:${path}`])
  const current = readFileSync(path)
  if (!tagged.equals(current)) {
    errors.push(`${path}: content differs from ${base}`)
  }
}

if (errors.length > 0) {
  fail(
    [
      `native SQL history is immutable after release (${base}):`,
      ...errors.map((error) => `  - ${error}`),
      'Add a new numbered script instead of deleting or editing released SQL.',
    ].join('\n')
  )
}

console.log(
  `native SQL history passed: ${taggedFiles.length} released script(s) unchanged since ${base}`
)

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: null,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim()
    fail(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout ?? Buffer.alloc(0)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
