import { readFileSync } from 'node:fs'

import { config } from 'dotenv'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertTestDatabase } from '../src/lib/test-db.js'
import { setupTestDB, teardownTestDB } from '../src/lib/test-helper.js'
import { DocumentRevisions } from '../src/modules/storage/document-revisions.js'

const native = readFileSync(new URL('../sql/0010_document-revisions.sql', import.meta.url), 'utf8')
const incremental =
  readFileSync(
    new URL('../src/database/migrations/0001_glorious_nehzno.sql', import.meta.url),
    'utf8'
  ) +
  '\n--> statement-breakpoint\n' +
  readFileSync(
    new URL('../src/database/migrations/0002_tiny_callisto.sql', import.meta.url),
    'utf8'
  )
const fixture = (text: string) =>
  text
    .replaceAll('byline_document_publish_schedules', 'byline_revision_fixture_schedules')
    .replaceAll('byline_documents', 'byline_revision_fixture_documents')
    .replaceAll('check_', 'fixture_check_')
const statements = fixture(native)
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean)
let connection: pg.Client
async function rows(statement: string): Promise<Array<Record<string, unknown>>> {
  return (await connection.query(statement)).rows
}
async function execute(statement: string): Promise<void> {
  await connection.query(statement)
}
async function reset(): Promise<void> {
  await execute('ROLLBACK')
  await execute('DROP TABLE IF EXISTS byline_revision_fixture_schedules')
  await execute('DROP TABLE IF EXISTS byline_revision_fixture_documents')
  await execute(
    `CREATE TABLE byline_revision_fixture_documents (id varchar(40) PRIMARY KEY, title varchar(100), order_key varchar(100))`
  )
  await execute(`CREATE TABLE byline_revision_fixture_schedules (
    document_id varchar(40) PRIMARY KEY, state varchar(32) NOT NULL,
    target_version_id varchar(40), publish_at timestamp NULL, suspended_at timestamp NULL,
    suspended_reason varchar(32), execution_token varchar(40), execution_expires_at timestamp NULL,
    updated_at timestamp NULL,
    CONSTRAINT fixture_check_document_publish_schedules_suspended_reason
      CHECK (suspended_reason IS NULL OR suspended_reason = 'content_edited')
  )`)
  await execute(
    "INSERT INTO byline_revision_fixture_documents (id, title, order_key) VALUES ('legacy', 'Preserve content', 'a0'), ('suspended', 'Second document', 'a1')"
  )
  await execute(
    "INSERT INTO byline_revision_fixture_schedules (document_id, state, target_version_id, publish_at, execution_token) VALUES ('legacy', 'armed', 'old-version', '2030-01-01 00:00:00', 'old-claim'), ('suspended', 'needs_reconfirm', 'other-version', '2030-01-02 00:00:00', NULL)"
  )
}
async function apply(): Promise<void> {
  await execute('BEGIN')
  try {
    for (const statement of statements) await execute(statement)
    await execute('COMMIT')
  } catch (error) {
    await execute('ROLLBACK')
    throw error
  }
}
async function snapshot() {
  return {
    documents: await rows('SELECT * FROM byline_revision_fixture_documents ORDER BY id'),
    schedules: await rows('SELECT * FROM byline_revision_fixture_schedules ORDER BY document_id'),
  }
}
async function assertUpgrade() {
  const state = await snapshot()
  expect(state.documents.map((row) => ({ ...row, revision: Number(row.revision) }))).toEqual([
    { id: 'legacy', title: 'Preserve content', order_key: 'a0', revision: 1 },
    { id: 'suspended', title: 'Second document', order_key: 'a1', revision: 1 },
  ])
  expect(state.schedules[0]).toMatchObject({
    state: 'needs_reconfirm',
    target_version_id: 'old-version',
    suspended_reason: 'upgrade_invalidated',
    authorized_revision: null,
    execution_token: null,
    execution_expires_at: null,
  })
  expect(state.schedules[0]?.suspended_at).not.toBeNull()
  expect(state.schedules[1]).toMatchObject({
    state: 'needs_reconfirm',
    suspended_at: null,
    suspended_reason: null,
    authorized_revision: null,
  })
  const columns = await rows(
    "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'byline_revision_fixture_documents' AND column_name = 'revision'"
  )
  expect(columns[0]).toMatchObject({ column_default: null, is_nullable: 'NO' })
  await expect(
    execute("INSERT INTO byline_revision_fixture_documents (id) VALUES ('old-insert')")
  ).rejects.toThrow()
  for (const value of ['0', '-1', '9007199254740992']) {
    await expect(
      execute(
        `UPDATE byline_revision_fixture_documents SET revision = ${value} WHERE id = 'legacy'`
      )
    ).rejects.toThrow()
  }
  // Fencing is operational: NOT NULL cannot stop old UPDATE statements.
  await execute(
    "UPDATE byline_revision_fixture_documents SET title = 'Old writer can still update' WHERE id = 'legacy'"
  )
  expect(
    Number(
      (await rows("SELECT revision FROM byline_revision_fixture_documents WHERE id = 'legacy'"))[0]
        ?.revision
    )
  ).toBe(1)
}

describe('document revision native upgrade (postgres)', () => {
  beforeAll(async () => {
    config({ path: '.env.test' })
    const url = process.env.BYLINE_DB_POSTGRES_CONNECTION_STRING as string
    assertTestDatabase(url)
    connection = new pg.Client({ connectionString: url })
    await connection.connect()
  })
  afterAll(async () => {
    if (!connection) return
    await execute('ROLLBACK')
    await execute('DROP TABLE IF EXISTS byline_revision_fixture_schedules')
    await execute('DROP TABLE IF EXISTS byline_revision_fixture_documents')
    await connection.end()
    await teardownTestDB()
  })
  it('gives the incremental development chain the same occupied-data result as native SQL', async () => {
    await reset()
    for (const statement of fixture(incremental)
      .split('--> statement-breakpoint')
      .filter((s) => s.trim()))
      await execute(statement)
    await assertUpgrade()
  })
  it('upgrades occupied data, rejects obsolete inserts, and exposes the old UPDATE fencing boundary', async () => {
    await reset()
    await apply()
    await assertUpgrade()
  })
  it('resumes compatible partial columns without resetting counters and removes the default', async () => {
    await reset()
    await execute('ALTER TABLE byline_revision_fixture_documents ADD revision bigint DEFAULT 1')
    await execute('ALTER TABLE byline_revision_fixture_schedules ADD authorized_revision bigint')
    await execute("UPDATE byline_revision_fixture_documents SET revision = 7 WHERE id = 'legacy'")
    await apply()
    expect(
      Number(
        (
          await rows("SELECT revision FROM byline_revision_fixture_documents WHERE id = 'legacy'")
        )[0]?.revision
      )
    ).toBe(7)
    const columns = await rows(
      "SELECT column_default AS column_default, is_nullable AS is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'byline_revision_fixture_documents' AND column_name = 'revision'"
    )
    expect(columns).toEqual([{ column_default: null, is_nullable: 'NO' }])
  })
  it('is repeatable without resetting counters or newly authorized schedules', async () => {
    await reset()
    await apply()
    await execute("UPDATE byline_revision_fixture_documents SET revision = 9 WHERE id = 'legacy'")
    await execute(
      "UPDATE byline_revision_fixture_schedules SET state = 'armed', authorized_revision = 9, suspended_at = NULL, suspended_reason = NULL, execution_token = 'new-claim' WHERE document_id = 'legacy'"
    )
    const before = await snapshot()
    await apply()
    expect(await snapshot()).toEqual(before)
  })
  it('rejects an incompatible partial column with an actionable stage diagnostic', async () => {
    await reset()
    await execute('ALTER TABLE byline_revision_fixture_documents ADD revision varchar(20)')
    await expect(apply()).rejects.toThrow(/stage 1/)
    expect(
      (await rows("SELECT title FROM byline_revision_fixture_documents WHERE id = 'legacy'"))[0]
        ?.title
    ).toBe('Preserve content')
  })
  it('rolls back the entire native upgrade on invalid occupied data', async () => {
    await reset()
    await execute('ALTER TABLE byline_revision_fixture_documents ADD revision bigint')
    await execute("UPDATE byline_revision_fixture_documents SET revision = -1 WHERE id = 'legacy'")
    const before = await snapshot()
    await expect(apply()).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })
  it('rejects old or defaulted schemas during startup validation', async () => {
    const revisions = new DocumentRevisions(setupTestDB([]).dbManager)
    await execute('ALTER TABLE byline_documents RENAME COLUMN revision TO revision_legacy_fixture')
    try {
      await expect(revisions.assertCompatibleSchema()).rejects.toMatchObject({
        code: 'ERR_DATABASE',
        message: expect.stringContaining('Fence all writers/workers'),
      })
    } finally {
      await execute(
        'ALTER TABLE byline_documents RENAME COLUMN revision_legacy_fixture TO revision'
      )
    }
    await execute('ALTER TABLE byline_documents ALTER COLUMN revision SET DEFAULT 1')
    try {
      await expect(revisions.assertCompatibleSchema()).rejects.toMatchObject({
        code: 'ERR_DATABASE',
      })
    } finally {
      await execute('ALTER TABLE byline_documents ALTER COLUMN revision DROP DEFAULT')
    }
    await revisions.assertCompatibleSchema()
  })
  it('rejects a same-named but weaker range constraint during startup', async () => {
    const revisions = new DocumentRevisions(setupTestDB([]).dbManager)
    await execute('ALTER TABLE byline_documents DROP CONSTRAINT check_documents_revision')
    try {
      await execute(
        'ALTER TABLE byline_documents ADD CONSTRAINT check_documents_revision CHECK (revision >= 0)'
      )
      await expect(revisions.assertCompatibleSchema()).rejects.toMatchObject({
        code: 'ERR_DATABASE',
      })
    } finally {
      await execute('ALTER TABLE byline_documents DROP CONSTRAINT check_documents_revision')
      await execute(
        'ALTER TABLE byline_documents ADD CONSTRAINT check_documents_revision CHECK (revision BETWEEN 1 AND 9007199254740991)'
      )
    }
    await revisions.assertCompatibleSchema()
  })
  it('builds a fresh complete schema from the retained baseline plus incremental migration', async () => {
    const journal = JSON.parse(
      readFileSync(
        new URL('../src/database/migrations/meta/_journal.json', import.meta.url),
        'utf8'
      )
    ) as { entries: Array<{ tag: string }> }
    const baseline = readFileSync(
      new URL(`../src/database/migrations/${journal.entries[0]?.tag}.sql`, import.meta.url),
      'utf8'
    )
    // Use compact, isolated object names in the guarded test database. Include every
    // table, constraint and view from the actual baseline, not a hand-written subset.
    const fresh = (sql: string) =>
      sql
        .replaceAll('byline_', 'rf_')
        .replaceAll('idx_', 'rf_idx_')
        .replaceAll('check_', 'rf_check_')
        .replaceAll('fk_', 'rf_fk_')
        .replaceAll('uq_', 'rf_uq_')
        .replaceAll('unique_', 'rf_unique_')
    const baselineSql = fresh(baseline)
    const tables = Array.from(baselineSql.matchAll(/CREATE TABLE ["`]([^"`]+)["`]/g), (m) => m[1]!)
    const views = Array.from(baselineSql.matchAll(/\bVIEW ["`]([^"`]+)["`]/g), (m) => m[1]!)
    expect(tables.length).toBeGreaterThan(20)
    expect(views.length).toBeGreaterThanOrEqual(2)
    for (const view of views) await execute(`DROP VIEW IF EXISTS "${view}"`)
    try {
      for (const statement of baselineSql.split('--> statement-breakpoint').filter((s) => s.trim()))
        await execute(statement)
      for (const statement of fresh(incremental)
        .split('--> statement-breakpoint')
        .filter((s) => s.trim()))
        await execute(statement)
      const columns = await rows(
        "SELECT column_default AS column_default, is_nullable AS is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'rf_documents' AND column_name = 'revision'"
      )
      expect(columns).toEqual([{ column_default: null, is_nullable: 'NO' }])
    } finally {
      for (const view of views) await execute(`DROP VIEW IF EXISTS "${view}"`)
      for (const table of tables.toReversed())
        await execute(`DROP TABLE IF EXISTS "${table}" CASCADE`)
    }
  }, 120_000)
})
