import type { Connection } from 'mysql2/promise'
import { expect, it, vi } from 'vitest'

import { loadBaseline } from './assets.js'
import { installOnConnection } from './runner.js'

it('rejects an unverified MySQL patch before acquiring a lock or creating the journal', async () => {
  const query = vi.fn().mockResolvedValue([[{ version: '8.4.12', db: 'unsupported_test' }]])
  await expect(
    installOnConnection({ query } as unknown as Connection, loadBaseline())
  ).rejects.toThrow(/unsupported-engine.*8\.4\.12/)
  expect(query).toHaveBeenCalledTimes(1)
  expect(query.mock.calls[0]?.[0]).toMatch(/^SELECT VERSION\(\)/)
})
