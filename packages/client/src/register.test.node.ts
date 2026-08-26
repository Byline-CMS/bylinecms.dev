/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expectTypeOf, it } from 'vitest'

import type { BylineClient } from './client.js'
import type { RegisteredCollections, RegisteredSingletons } from './register.js'

describe('unaugmented client registration fallback', () => {
  it('keeps both path registries loose outside an application program', () => {
    expectTypeOf<RegisteredCollections>().toEqualTypeOf<Record<string, Record<string, any>>>()
    expectTypeOf<RegisteredSingletons>().toEqualTypeOf<Record<string, Record<string, any>>>()
    expectTypeOf<Parameters<BylineClient['collection']>[0]>().toEqualTypeOf<string>()
    expectTypeOf<Parameters<BylineClient['singleton']>[0]>().toEqualTypeOf<string>()
  })
})
