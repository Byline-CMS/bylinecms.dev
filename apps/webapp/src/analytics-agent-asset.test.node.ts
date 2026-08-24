/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ANALYTICS_AGENT_SOURCE } from '@byline/analytics-agent/source'
import { describe, expect, it } from 'vitest'

const publicAgentPath = fileURLToPath(new URL('../public/b.js', import.meta.url))

describe('public analytics agent', () => {
  it('matches the standalone artifact from the installed package', () => {
    expect(readFileSync(publicAgentPath, 'utf8')).toBe(ANALYTICS_AGENT_SOURCE)
  })
})
