import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { StateStore } from './state.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('StateStore database adapter migration', () => {
  it('keeps a genuinely fresh state adapter-free', () => {
    const root = temporaryRoot()
    const state = new StateStore(root)

    expect(state.get().answers.dbAdapter).toBeUndefined()
  })

  it('migrates a legacy database installation to PostgreSQL and strips old secrets', () => {
    const root = temporaryRoot()
    const path = join(root, '.byline-install.json')
    writeFileSync(
      path,
      `${JSON.stringify({
        version: 1,
        startedAt: '2026-07-01T00:00:00.000Z',
        completedPhases: ['db'],
        answers: {
          dbHost: '127.0.0.1',
          dbPort: 5432,
          dbName: 'byline',
          dbUser: 'byline',
          superuserUrl: 'postgresql://postgres:secret@127.0.0.1:5432/postgres',
        },
        wireSubEdits: {},
      })}\n`
    )

    const state = new StateStore(root)
    expect(state.get().answers.dbAdapter).toBe('postgres')
    expect(state.get().answers).not.toHaveProperty('superuserUrl')

    state.flush()
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      answers: Record<string, unknown>
    }
    expect(persisted.answers.dbAdapter).toBe('postgres')
    expect(persisted.answers).not.toHaveProperty('superuserUrl')
  })

  it('does not infer PostgreSQL from unrelated persisted prompt answers', () => {
    const root = temporaryRoot()
    const path = join(root, '.byline-install.json')
    writeFileSync(
      path,
      `${JSON.stringify({
        version: 1,
        startedAt: '2026-07-01T00:00:00.000Z',
        completedPhases: ['prompts'],
        answers: { adminPath: '/admin', examples: true },
        wireSubEdits: {},
      })}\n`
    )

    const state = new StateStore(root)
    expect(state.get().answers.dbAdapter).toBeUndefined()
  })

  it('renames an unreleased dbDialect selection without changing its value', () => {
    const root = temporaryRoot()
    const path = join(root, '.byline-install.json')
    writeFileSync(
      path,
      `${JSON.stringify({
        version: 1,
        startedAt: '2026-07-01T00:00:00.000Z',
        completedPhases: [],
        answers: { dbDialect: 'mysql' },
        wireSubEdits: {},
      })}\n`
    )

    const state = new StateStore(root)
    expect(state.get().answers.dbAdapter).toBe('mysql')

    state.flush()
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      answers: Record<string, unknown>
    }
    expect(persisted.answers.dbAdapter).toBe('mysql')
    expect(persisted.answers).not.toHaveProperty('dbDialect')
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'byline-cli-state-test-'))
  roots.push(root)
  return root
}
