import { describe, expect, it } from 'vitest'

import { buildDbUrl, defaultDbPort, parseDbUrl, withDbDatabase } from './urls.js'

describe.each([
  ['postgres', 'postgresql', 5432],
  ['mysql', 'mysql', 3306],
] as const)('%s database URLs', (dialect, protocol, defaultPort) => {
  it('round-trips encoded credentials and database names', () => {
    const parts = {
      host: 'db.example.test',
      port: defaultPort,
      user: "by/line'editor",
      password: 'p@ss/#% word',
      database: 'byline content',
    }
    const rendered = buildDbUrl(dialect, parts)

    expect(rendered).toMatch(new RegExp(`^${protocol}://`))
    expect(rendered).not.toContain(parts.password)
    expect(parseDbUrl(rendered, dialect)).toEqual(parts)
  })

  it('uses the dialect default port and can replace the database', () => {
    const parsed = parseDbUrl(`${protocol}://root:secret@localhost/system`, dialect)
    expect(parsed.port).toBe(defaultPort)
    expect(defaultDbPort(dialect)).toBe(defaultPort)
    expect(withDbDatabase(parsed, 'byline')).toMatchObject({ database: 'byline' })
  })
})

it('rejects a connection URL for the wrong dialect', () => {
  expect(() => parseDbUrl('mysql://root:secret@localhost/mysql', 'postgres')).toThrow(
    'expected postgres connection URL'
  )
  expect(() => parseDbUrl('postgresql://root:secret@localhost/postgres', 'mysql')).toThrow(
    'expected mysql connection URL'
  )
})
