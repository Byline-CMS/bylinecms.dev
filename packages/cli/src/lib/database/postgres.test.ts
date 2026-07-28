import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

import { postgresProvisioner, postgresRoleStatements } from './postgres.js'

describe('PostgreSQL provisioner', () => {
  it('registers for PostgreSQL', () => {
    expect(postgresProvisioner.adapter).toBe('postgres')
  })

  it('escapes role identifiers and password literals', () => {
    const statements = postgresRoleStatements(new Client(), 'role"name', "p'ass\\word")

    expect(statements.create).toBe('CREATE ROLE "role""name" WITH LOGIN')
    expect(statements.alter).toBe('ALTER ROLE "role""name" WITH PASSWORD  E\'p\'\'ass\\\\word\'')
  })
})
