/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Guards the `keyv` hold in `pnpm-workspace.yaml` (`updateConfig.ignoreDependencies`).
 *
 * The webapp constructs the `Keyv` instance that `cache-manager` and
 * `cacheable` consume (see `cache-manager.ts`), so the webapp's `keyv` must
 * satisfy the range both libraries declare. keyv 6 removed
 * `get(key, { raw: true })`, which cache-manager@7 calls on every `wrap` —
 * a mismatch silently turns every `wrap` into a cache miss.
 *
 * This test fails in both directions:
 *   - keyv bumped ahead of the libraries → revert the bump.
 *   - the libraries move to a new keyv major → remove the workspace hold
 *     and upgrade keyv in `apps/webapp/package.json`.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
}

/** These packages do not export `./package.json`, so walk up from the entry point. */
function readPackageJson(name: string): PackageJson {
  let dir = dirname(require.resolve(name))
  while (dir !== dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
      if (pkg.name === name) return pkg
    } catch {
      // No package.json at this level — keep walking.
    }
    dir = dirname(dir)
  }
  throw new Error(`Could not locate package.json for ${name}`)
}

function parseVersion(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
  return [major, minor, patch]
}

/** Caret-range check (`^X.Y.Z`, X > 0) — the only range shape these libraries use. */
function satisfiesCaret(version: string, range: string): boolean {
  const match = /^\^(\d+\.\d+\.\d+)$/.exec(range)
  if (match?.[1] == null) throw new Error(`Unsupported range "${range}" — extend this test`)
  const [min, actual] = [parseVersion(match[1]), parseVersion(version)]
  if (actual[0] !== min[0]) return false
  for (let i = 1; i < 3; i++) {
    if (actual[i] !== min[i]) return (actual[i] ?? 0) > (min[i] ?? 0)
  }
  return true
}

describe('keyv compatibility', () => {
  const keyv = readPackageJson('keyv')

  for (const consumer of ['cache-manager', 'cacheable']) {
    it(`installed keyv satisfies the range ${consumer} declares`, () => {
      const pkg = readPackageJson(consumer)
      const range = pkg.dependencies?.keyv
      expect(
        range,
        `${consumer} no longer depends on keyv — revisit the workspace hold`
      ).toBeDefined()
      expect(
        satisfiesCaret(keyv.version, range as string),
        `${consumer}@${pkg.version} requires keyv ${range}, but keyv@${keyv.version} is installed. ` +
          'If keyv was bumped ahead of it, revert the bump. If the requirement moved to a new ' +
          'major, remove keyv from updateConfig.ignoreDependencies in pnpm-workspace.yaml and ' +
          'upgrade keyv in apps/webapp/package.json.'
      ).toBe(true)
    })
  }
})
