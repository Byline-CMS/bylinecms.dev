import { readFileSync, rmSync, writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { findMissingEnvKeys } from '../commands/setup-checks.js'
import { envSpecsForAdapter } from '../manifest/env.js'
import { createTestContext } from '../test-helpers.js'
import { envPhase } from './env.js'
import type { Context } from '../context.js'

const contexts: Context[] = []

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe.each([
  ['postgres', 'BYLINE_DB_POSTGRES_CONNECTION_STRING', 'BYLINE_DB_MYSQL_CONNECTION_STRING'],
  ['mysql', 'BYLINE_DB_MYSQL_CONNECTION_STRING', 'BYLINE_DB_POSTGRES_CONNECTION_STRING'],
] as const)('%s environment generation', (adapter, selectedKey, alternateKey) => {
  it('requires only the selected database key', () => {
    const keys = envSpecsForAdapter(adapter).map((spec) => spec.key)
    expect(keys).toContain(selectedKey)
    expect(keys).not.toContain(alternateKey)
  })

  it('writes only the selected database key into a clean fixture', async () => {
    const ctx = createTestContext({
      dbAdapter: adapter,
      dbHost: '127.0.0.1',
      dbPort: adapter === 'postgres' ? 5432 : 3306,
      dbName: 'byline_dev',
      dbUser: 'byline',
    })
    contexts.push(ctx)
    ctx.secrets.dbPassword = 'password'

    expect((await envPhase.apply(await envPhase.plan(ctx), ctx)).state).toBe('done')
    const secret = readFileSync(ctx.resolve('.env.local'), 'utf8')
    expect(secret).toContain(`${selectedKey}=`)
    expect(secret).not.toContain(`${alternateKey}=`)
  })

  it('writes the selected URL and preserves an existing alternate-adapter key', async () => {
    const ctx = createTestContext({
      dbAdapter: adapter,
      dbHost: '127.0.0.1',
      dbPort: adapter === 'postgres' ? 5432 : 3306,
      dbName: 'byline_dev',
      dbUser: 'byline',
    })
    contexts.push(ctx)
    ctx.secrets.dbPassword = 'p@ss word'
    writeFileSync(ctx.resolve('.env.local'), `${alternateKey}=keep-me\n`)

    expect((await envPhase.apply(await envPhase.plan(ctx), ctx)).state).toBe('done')
    const secret = readFileSync(ctx.resolve('.env.local'), 'utf8')
    expect(secret).toContain(`${selectedKey}=`)
    expect(secret).toContain(`${alternateKey}=keep-me`)
    expect(secret).toContain(encodeURIComponent('p@ss word'))
  })

  it('makes setup checks report the selected key and ignore the alternate key', () => {
    const ctx = createTestContext({ dbAdapter: adapter })
    contexts.push(ctx)
    writeFileSync(ctx.resolve('.env'), 'VITE_SERVER_URL=http://localhost:3000/\n')
    writeFileSync(
      ctx.resolve('.env.local'),
      [
        'BYLINE_JWT_SECRET=secret',
        'BYLINE_SUPERADMIN_EMAIL=admin@example.test',
        'BYLINE_SUPERADMIN_PASSWORD=password',
        `${alternateKey}=keep-me`,
        '',
      ].join('\n')
    )

    expect(findMissingEnvKeys(ctx)).toEqual([selectedKey])
  })
})

it('blocks a genuinely fresh state with no selected database', async () => {
  const ctx = createTestContext({ dbAdapter: undefined })
  contexts.push(ctx)

  expect(await envPhase.detect(ctx)).toBe('blocked')
  expect((await envPhase.plan(ctx)).notes).toContain(
    'database adapter missing — run db phase first'
  )
  expect(findMissingEnvKeys(ctx)).toEqual([
    'VITE_SERVER_URL',
    'BYLINE_JWT_SECRET',
    'BYLINE_SUPERADMIN_EMAIL',
    'BYLINE_SUPERADMIN_PASSWORD',
  ])
})
