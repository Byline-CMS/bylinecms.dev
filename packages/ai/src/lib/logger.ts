/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type BylineLogger, getLogger as getCoreLogger } from '@byline/core'

/**
 * Resolve a logger for `@byline/ai` in priority order:
 *   1. `getLogger()` from `@byline/core` if `initBylineCore()` registered one
 *   2. silent no-op fallback
 *
 * The silent fallback mirrors `@byline/client`: AI execution can be invoked
 * from one-off scripts and tests that don't run `initBylineCore()`, and we
 * don't want those contexts to throw or noisily warn just because a logger
 * isn't wired up. Fully-wired runtimes still get the real logger via step 1.
 */
const noop = () => {}
const silentLogger: BylineLogger = {
  log: noop,
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
  silent: noop,
}

export const getLogger = (): BylineLogger => {
  try {
    return getCoreLogger()
  } catch {
    return silentLogger
  }
}
