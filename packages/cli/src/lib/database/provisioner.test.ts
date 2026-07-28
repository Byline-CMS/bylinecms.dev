import { describe, expect, it } from 'vitest'

import {
  DATABASE_PROVISIONERS,
  databaseIdentifierRequirement,
  isValidDatabaseIdentifier,
} from './provisioner.js'

describe('database provisioner registry', () => {
  it('registers both supported adapters', () => {
    expect(DATABASE_PROVISIONERS.postgres.adapter).toBe('postgres')
    expect(DATABASE_PROVISIONERS.mysql.adapter).toBe('mysql')
  })
})

describe('database identifier policy', () => {
  it.each([
    ['postgres', 'database', 'a'.repeat(63), true],
    ['postgres', 'database', 'a'.repeat(64), false],
    ['mysql', 'database', 'a'.repeat(64), true],
    ['mysql', 'database', 'a'.repeat(65), false],
    ['mysql', 'user', 'a'.repeat(32), true],
    ['mysql', 'user', 'a'.repeat(33), false],
    ['mysql', 'user', "editor'ops", false],
    ['postgres', 'user', 'Editor', false],
  ] as const)('%s %s identifier %j is valid=%s', (adapter, kind, value, valid) => {
    expect(isValidDatabaseIdentifier(adapter, kind, value)).toBe(valid)
  })

  it('describes the MySQL account-name limit', () => {
    expect(databaseIdentifierRequirement('mysql', 'user')).toContain('max 32')
  })
})
