/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Regression tests for the released-SQL immutability guard.
 *
 * Each case builds a throwaway git repository, tags it as a release, mutates
 * it, and runs the real script as a subprocess. Asserting on the regex alone
 * would prove nothing about the behaviour that matters, which is whether a
 * release is actually refused.
 *
 * The guard exists because every numbered migration runner in this repository
 * records applied *versions*, not their content. Amending a released file
 * therefore changes what a fresh database receives while leaving every
 * existing database untouched, and both then report the same version.
 *
 * Run with `pnpm test:scripts`.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'check-native-sql-history.mjs')
const repos = []

after(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true })
})

/** A git repository holding `files`, committed and tagged `v1`. */
function releasedRepo(files) {
  const repo = mkdtempSync(join(tmpdir(), 'sql-history-'))
  repos.push(repo)
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  write(repo, files)
  git('add', '-A')
  git('commit', '-q', '-m', 'release')
  git('tag', 'v1')
  return repo
}

function write(repo, files) {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(repo, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, contents)
  }
}

/** Run the guard in `repo` against tag v1. */
function check(repo) {
  const result = spawnSync('node', [SCRIPT, '--base', 'v1'], { cwd: repo, encoding: 'utf8' })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

describe('released SQL is immutable', () => {
  // The exact defect this guard failed to catch: 0001_init.sql was amended in
  // place in 4.9.0 rather than superseded by a new numbered file.
  it('fails when a released search-postgres migration is edited', () => {
    const repo = releasedRepo({
      'packages/search-postgres/migrations/0001_init.sql': 'CREATE TABLE a (id int);\n',
    })
    write(repo, {
      'packages/search-postgres/migrations/0001_init.sql':
        'CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n',
    })

    const { code, out } = check(repo)
    assert.equal(code, 1, `expected failure, got:\n${out}`)
    assert.match(out, /0001_init\.sql: content differs from v1/)
    assert.match(out, /Add a new numbered script instead/)
  })

  // Every directory the pattern is responsible for, so narrowing it back to
  // `packages/db-*/sql/` fails here rather than in production.
  for (const path of [
    'packages/db-postgres/sql/0008_add-thing.sql',
    'packages/db-mysql/sql/0003_add-thing.sql',
    'packages/search-postgres/migrations/0001_init.sql',
    'packages/search-mysql/migrations/0001_init.sql',
    'packages/analytics-postgres/migrations/0001_init.sql',
    'packages/analytics-mysql/migrations/0001_init.sql',
  ]) {
    it(`watches ${path}`, () => {
      const repo = releasedRepo({ [path]: 'SELECT 1;\n' })
      write(repo, { [path]: 'SELECT 2;\n' })
      const { code, out } = check(repo)
      assert.equal(code, 1, `${path} is unwatched:\n${out}`)
    })
  }

  it('fails when a released migration is deleted', () => {
    const repo = releasedRepo({
      'packages/search-postgres/migrations/0001_init.sql': 'SELECT 1;\n',
    })
    rmSync(join(repo, 'packages/search-postgres/migrations/0001_init.sql'))

    const { code, out } = check(repo)
    assert.equal(code, 1, `expected failure, got:\n${out}`)
    assert.match(out, /deleted after v1/)
  })

  it('passes when a new numbered migration is added alongside', () => {
    const repo = releasedRepo({
      'packages/search-postgres/migrations/0001_init.sql': 'SELECT 1;\n',
    })
    write(repo, {
      'packages/search-postgres/migrations/0002_repair.sql': 'SELECT 2;\n',
    })

    const { code, out } = check(repo)
    assert.equal(code, 0, `superseding must be allowed, got:\n${out}`)
    assert.match(out, /1 released script\(s\) unchanged/)
  })

  // Drizzle's squashed baselines are rewritten by design; `sync:baselines` and
  // baseline-drift.test.ts govern them instead. Watching them here would make
  // every baseline squash a release blocker.
  for (const path of [
    'packages/db-postgres/src/database/migrations/0000_lively_talisman.sql',
    'packages/cli/src/templates/migrations/postgres/0000_lively_talisman.sql',
  ]) {
    it(`ignores the squashed baseline at ${path}`, () => {
      const repo = releasedRepo({ [path]: 'SELECT 1;\n' })
      write(repo, { [path]: 'SELECT 2;\n' })
      const { code } = check(repo)
      assert.equal(code, 0, `${path} must stay outside this guard`)
    })
  }

  // Unnumbered SQL is not part of a migration stream.
  it('ignores unnumbered SQL', () => {
    const repo = releasedRepo({ 'packages/db-postgres/sql/helpers.sql': 'SELECT 1;\n' })
    write(repo, { 'packages/db-postgres/sql/helpers.sql': 'SELECT 2;\n' })
    const { code } = check(repo)
    assert.equal(code, 0)
  })
})
