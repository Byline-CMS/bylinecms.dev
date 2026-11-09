/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pins the Nitro features every Byline host inherits. The end-to-end proof
 * that a thrown Response keeps its status in a built server lives in
 * `apps/webapp/tests/built-server-status`.
 */
import { describe, expect, it } from 'vitest'

import { bylineNitroFeatures } from './nitro-features.js'

describe('bylineNitroFeatures', () => {
  it('disables srvx FastResponse (h3js/srvx#343)', () => {
    expect(bylineNitroFeatures()).toEqual({ fastResponse: false })
  })

  it('keeps the host features and overrides only fastResponse', () => {
    const hostFeatures = { websocket: true, fastResponse: true }
    expect(bylineNitroFeatures(hostFeatures)).toEqual({ websocket: true, fastResponse: false })
    expect(hostFeatures.fastResponse).toBe(true)
  })
})
