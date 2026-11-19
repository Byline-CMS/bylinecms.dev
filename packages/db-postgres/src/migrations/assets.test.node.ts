import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { loadStorageSteps, type StorageStep, validatePolicy, validateRunnerSql } from './assets.js'

it('ships one verified SQL file per step and excludes transaction and ownership control', () => {
  const steps = loadStorageSteps()
  expect(steps[0]?.version).toBe(15)
  for (const step of steps) expect(() => validateRunnerSql(step.sql)).not.toThrow()
  for (const unsafe of [
    'COMMIT',
    '-- comment\n BEGIN',
    'GRANT SELECT ON a TO b',
    'ALTER TABLE a OWNER TO b',
    'CREATE INDEX CONCURRENTLY idx ON a(id)',
    '/* byline:ownership-guard */ SELECT 1',
  ]) {
    expect(() => validateRunnerSql(`SELECT 1; ${unsafe}`)).toThrow(/transaction and ownership/)
  }
})

it('routes the testing bootstrap to the same adapter installation entry point', () => {
  const helper = readFileSync(new URL('../lib/test-db.ts', import.meta.url), 'utf8')
  expect(helper).toContain("from '../migrations/index.js'")
  expect(helper).toContain('await installCoreStorage(connectionString)')
  expect(helper).not.toContain('node-postgres/migrator')
})

it('requires complete release evidence, bounded timeouts and a monotonic predecessor-compatible floor', () => {
  const baseline = loadStorageSteps()[0]!
  const step: StorageStep = {
    ...baseline,
    version: 17,
    classification: 'online',
    compatible_from: 15,
    online: {
      tested_releases: { '6.13.4': 15, '6.14.0': 16 },
      evidence: 'test coverage across both contracts',
      lock_timeout_ms: 50,
      statement_timeout_ms: 500,
    },
  }
  expect(validatePolicy(step, 15)).toBe(true)
  expect(validatePolicy(step, 16)).toBe(false)
  expect(validatePolicy({ ...step, compatible_from: 17 }, 15)).toBe(false)
  expect(
    validatePolicy({ ...step, online: { ...step.online!, tested_releases: { '6.14.0': 16 } } }, 15)
  ).toBe(false)
  expect(
    validatePolicy({ ...step, online: { ...step.online!, statement_timeout_ms: 0 } }, 15)
  ).toBe(false)
  expect(validatePolicy({ ...step, classification: 'fenced' }, 15)).toBe(false)
})
