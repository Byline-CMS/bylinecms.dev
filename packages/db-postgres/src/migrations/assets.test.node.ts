import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { loadStorageSteps, type StorageStep, validatePolicy } from './assets.js'

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

it('keeps released PostgreSQL storage frozen until startup enforcement ships', () => {
  expect(loadStorageSteps().map((step) => [step.version, step.classification])).toEqual([
    [15, 'fenced'],
  ])
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
