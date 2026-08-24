/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { createAnalyticsPrivacyStatement } from './privacy-statement.js'

describe('createAnalyticsPrivacyStatement', () => {
  it('renders deployment-specific retention and exclusion copy', () => {
    const statement = createAnalyticsPrivacyStatement({
      operatorName: 'Example News',
      exclusionInstructions: 'Use the Exclude my visits control on this site.',
      pathRetentionDays: 365,
      referrerRetentionDays: null,
    })

    expect(statement.title).toBe('Example News analytics privacy')
    expect(statement.paragraphs.join(' ')).toContain('up to 90 days')
    expect(statement.paragraphs.join(' ')).toContain('up to 365 days')
    expect(statement.paragraphs.join(' ')).toContain('referrer totals are retained indefinitely')
    expect(statement.paragraphs.at(-1)).toBe('Use the Exclude my visits control on this site.')
  })

  it('rejects blank deployment copy and invalid retention', () => {
    expect(() =>
      createAnalyticsPrivacyStatement({ operatorName: '', exclusionInstructions: 'Use opt-out.' })
    ).toThrow('operatorName')
    expect(() =>
      createAnalyticsPrivacyStatement({
        operatorName: 'Example',
        exclusionInstructions: 'Use opt-out.',
        pathRetentionDays: 0,
      })
    ).toThrow('retention')
  })
})
