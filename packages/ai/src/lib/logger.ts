/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// TODO: refactor our singletons to use some sort of container
// or context - like https://github.com/jeffijoe/awilix

import type { BaseLogger } from 'pino'
import logger from 'pino'

let cached: BaseLogger | undefined

export const getLogger = (): BaseLogger => {
  if (cached == null) {
    cached = logger({ level: 'debug' })
  }
  return cached
}
