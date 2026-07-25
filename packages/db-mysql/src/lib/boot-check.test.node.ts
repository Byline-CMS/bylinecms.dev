/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { assertMySqlVersion } from './boot-check.js'

const queryReturning = (v: string) => async () => [{ v }]

describe('assertMySqlVersion', () => {
  describe('accepts supported MySQL server versions', () => {
    it.each([
      ['8.0.14', '8.0.14 — the exact floor'],
      ['8.4.0', '8.4.0'],
      ['9.7.1', "9.7.1 — this repo's dev container"],
      ['8.0.35-0ubuntu0.22.04.1', 'a distro-suffixed release string'],
    ])('%s (%s)', async (version) => {
      await expect(assertMySqlVersion(queryReturning(version))).resolves.toBeUndefined()
    })
  })

  describe('rejects unsupported servers', () => {
    it.each([
      ['8.0.13', 'one patch below the floor'],
      ['8.0.0', 'the 8.0 GA release, below the floor'],
      ['5.7.44', 'MySQL 5.7'],
      ['11.4.2-MariaDB', 'a MariaDB version string'],
      ['5.5.5-10.11.2-MariaDB', 'the MariaDB replication-handshake version shape'],
    ])('%s (%s)', async (version) => {
      await expect(assertMySqlVersion(queryReturning(version))).rejects.toThrow(
        /MariaDB is not supported/
      )
    })

    it('names MariaDB explicitly, not just a failed numeric comparison', async () => {
      await expect(assertMySqlVersion(queryReturning('11.4.2-MariaDB'))).rejects.toThrow(/MariaDB/)
      await expect(assertMySqlVersion(queryReturning('5.5.5-10.11.2-MariaDB'))).rejects.toThrow(
        /MariaDB/
      )
    })
  })

  describe('malformed results', () => {
    it('throws a clear error (not a destructuring TypeError) when the query returns no rows', async () => {
      await expect(assertMySqlVersion(async () => [])).rejects.toThrow(/@byline\/db-mysql/)
      await expect(assertMySqlVersion(async () => [])).rejects.not.toThrow(TypeError)
    })

    it('throws a clear error when the query returns a row without a usable version string', async () => {
      await expect(
        assertMySqlVersion(async () => [{ v: undefined as unknown as string }])
      ).rejects.toThrow(/@byline\/db-mysql/)
    })
  })
})
