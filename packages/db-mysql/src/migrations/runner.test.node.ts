import type { Connection } from 'mysql2/promise'
import { expect, it, vi } from 'vitest'

import { applyPatchEvidence, loadBaseline } from './assets.js'
import { checkFleet, directSessionId } from './operations.js'

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

it('accepts append-only patch evidence only for the same immutable step and entire tested writer set', () => {
  const step = {
    ...loadBaseline(),
    version: 11,
    name: 'fixture',
    classification: 'online' as const,
    online: {
      evidence: 'initial matrix',
      server_versions: ['8.4.13'],
      tested_releases: { '6.13.4': 10 },
      lock_timeout_ms: 1000,
      statement_timeout_ms: 2000,
    },
  }
  const manifest = 'a'.repeat(64),
    file = '0011_fixture.online-8.4.14.json'
  const proof = {
    server_version: '8.4.14',
    sql_sha256: step.sha256,
    manifest_sha256: manifest,
    tested_releases: { '6.13.4': 10 },
    evidence: 'release fixture run',
  }
  for (const invalid of [
    { ...proof, sql_sha256: 'b'.repeat(64) },
    { ...proof, manifest_sha256: 'c'.repeat(64) },
    { ...proof, tested_releases: {} },
  ])
    expect(() => applyPatchEvidence(step, manifest, file, invalid)).toThrow()
  applyPatchEvidence(step, manifest, file, proof)
  expect(step.online.server_versions).toEqual(['8.4.13', '8.4.14'])
  expect(() => applyPatchEvidence(step, manifest, file, proof)).toThrow(/duplicate/)
})
