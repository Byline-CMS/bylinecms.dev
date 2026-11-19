import type { Connection } from 'mysql2/promise'
import { expect, it, vi } from 'vitest'

import { loadBaseline } from './assets.js'
import { checkFleet, directSessionId } from './operations.js'
import { installOnConnection } from './runner.js'

it('rejects an unverified MySQL patch before acquiring a lock or creating the journal', async () => {
  const query = vi.fn().mockResolvedValue([[{ version: '8.4.12', db: 'unsupported_test' }]])
  await expect(
    installOnConnection({ query } as unknown as Connection, loadBaseline())
  ).rejects.toThrow(/unsupported-engine.*8\.4\.12/)
  expect(query).toHaveBeenCalledTimes(1)
  expect(query.mock.calls[0]?.[0]).toMatch(/^SELECT VERSION\(\)/)
})

it('rejects a proxy handshake ID that differs from the backend before any cancellation can run', async () => {
  const session = (handshake: number, sql: number) =>
    ({
      threadId: handshake,
      query: vi.fn().mockResolvedValue([[{ id: 'same-server', session: sql }]]),
    }) as unknown as Connection
  await expect(directSessionId(session(93, 19), session(94, 94))).rejects.toThrow(/direct sessions/)
  await expect(directSessionId(session(19, 19), session(94, 94))).resolves.toBe(19)
})

it('requires one consistent contract per fleet release across all pending steps and both endpoint versions', () => {
  const base = loadBaseline()
  const step = (version: number, contract: number) => ({
    ...base,
    version,
    classification: 'online' as const,
    online: {
      server_versions: ['8.4.13'],
      evidence: 'fixture',
      tested_releases: { '6.13.4': contract },
      lock_timeout_ms: 1000,
      statement_timeout_ms: 2000,
    },
  })
  expect(() => checkFleet([step(12, 10), step(13, 11)], ['6.13.4'], 11, '8.4.13')).toThrow(
    /inconsistent/
  )
  expect(() => checkFleet([step(12, 11)], ['6.13.4'], 10, '8.4.13')).toThrow(/unproved/)
})
