import { describe, expect, it } from 'vitest'

import { assertSupportedMySqlVersion, mysqlAccountSql, mysqlProvisionStatements } from './mysql.js'

describe('MySQL version support', () => {
  it.each(['8.0.14', '8.4.0', '9.7.1', '8.0.35-0ubuntu0.22.04.1'])('accepts %s', (version) => {
    expect(() => assertSupportedMySqlVersion(version)).not.toThrow()
  })

  it.each(['8.0.13', '8.0.0', '5.7.44', '11.4.2-MariaDB', '5.5.5-10.11.2-MariaDB'])(
    'rejects %s',
    (version) => {
      expect(() => assertSupportedMySqlVersion(version)).toThrow(/MariaDB is not supported/)
    }
  )

  it.each([undefined, '', 'not-a-version'])('rejects malformed result %j clearly', (version) => {
    expect(() => assertSupportedMySqlVersion(version)).toThrow(/@byline\/db-mysql/)
  })
})

describe('MySQL SQL escaping', () => {
  it('escapes account names as values rather than identifiers', () => {
    expect(mysqlAccountSql("editor'ops")).toBe("'editor\\'ops'@'%'")
  })

  it('escapes identifiers and hostile passwords in provisioning statements', () => {
    const statements = mysqlProvisionStatements({
      database: 'byline`content',
      user: "editor'ops",
      password: "p@ss'word\\end",
      createDatabase: true,
    })

    expect(statements).toContain("ALTER USER 'editor\\'ops'@'%' IDENTIFIED BY 'p@ss\\'word\\\\end'")
    expect(statements).toContain(
      'CREATE DATABASE `byline``content` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
    )
    expect(statements).toContain(
      "GRANT ALL PRIVILEGES ON `byline``content`.* TO 'editor\\'ops'@'%'"
    )
  })
})
