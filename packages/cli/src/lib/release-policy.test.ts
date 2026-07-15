import { describe, expect, it } from 'vitest'

import { deriveBylineReleasePolicy } from './release-policy.js'

describe('deriveBylineReleasePolicy', () => {
  it.each([
    [
      '3.21.0',
      {
        dependencyRange: '^3.21.0',
        supportedRange: '>=3.21.0 <4.0.0-0',
        displayFloor: '3.21.x+',
      },
    ],
    [
      '4.0.0',
      {
        dependencyRange: '^4.0.0',
        supportedRange: '>=4.0.0 <5.0.0-0',
        displayFloor: '4.0.x+',
      },
    ],
    [
      '5.2.1',
      {
        dependencyRange: '^5.2.1',
        supportedRange: '>=5.2.1 <6.0.0-0',
        displayFloor: '5.2.x+',
      },
    ],
  ])('derives the lockstep policy for %s', (version, expected) => {
    expect(deriveBylineReleasePolicy(version)).toEqual(expected)
  })

  it('rejects an invalid package version', () => {
    expect(() => deriveBylineReleasePolicy('next')).toThrow('Invalid @byline/cli package version')
  })
})
