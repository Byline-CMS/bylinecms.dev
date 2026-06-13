/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Guard against `publishConfig.exports` drift.
 *
 * `@byline/admin` carries a `publishConfig.exports` block that npm uses to
 * **override** the top-level `exports` at publish time. The workspace and dev
 * builds resolve through the top-level `exports` (or source), so a subpath
 * added there but forgotten in `publishConfig.exports` typechecks and builds
 * locally yet is **missing from the published package** — surfacing only as a
 * downstream consumer's build error ("X is not exported …"). That is exactly
 * how `./admin-activity` slipped through in v3.11.0.
 *
 * This test fails the moment the two blocks drift, so the gap is caught in
 * `pnpm test` / CI rather than in a production Docker build.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  exports: Record<string, unknown>
  publishConfig?: { exports?: Record<string, unknown> }
}

describe('package.json export parity', () => {
  it('every top-level export subpath is also declared in publishConfig.exports', () => {
    const publishExports = pkg.publishConfig?.exports
    // If there is no override, the top-level exports ship as-is — nothing to check.
    if (publishExports == null) return

    const missing = Object.keys(pkg.exports).filter((key) => !(key in publishExports))
    expect(
      missing,
      `publishConfig.exports is missing subpath(s) present in the top-level exports: ${missing.join(
        ', '
      )}. The published package would not expose them — add them to BOTH blocks.`
    ).toEqual([])
  })
})
