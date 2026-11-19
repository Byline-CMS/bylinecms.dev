import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { loadStorageSteps } from './assets.js'

it('ships one verified SQL file per step and excludes transaction and ownership control', () => {
  const steps = loadStorageSteps()
  expect(steps[0]?.version).toBe(15)
  for (const step of steps) {
    const sql = step.sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(sql).not.toMatch(
      /(?:^|;)\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|GRANT|REVOKE|VACUUM)\b/im
    )
    expect(sql).not.toMatch(/\b(?:OWNER\s+TO|REASSIGN\s+OWNED|INDEX\s+CONCURRENTLY)\b/i)
    expect(step.sql).not.toContain('byline:ownership-guard')
  }
})

it('routes the testing bootstrap to the same adapter installation entry point', () => {
  const helper = readFileSync(new URL('../lib/test-db.ts', import.meta.url), 'utf8')
  expect(helper).toContain("from '../migrations/index.js'")
  expect(helper).toContain('await installCoreStorage(connectionString)')
  expect(helper).not.toContain('node-postgres/migrator')
})
