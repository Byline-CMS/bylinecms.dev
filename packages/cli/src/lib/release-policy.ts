import { createRequire } from 'node:module'

import { parse } from 'semver'

export interface BylineReleasePolicy {
  dependencyRange: string
  supportedRange: string
  displayFloor: string
}

/** Derive every CLI package-compatibility value from one release version. */
export function deriveBylineReleasePolicy(cliVersion: string): BylineReleasePolicy {
  const parsed = parse(cliVersion)
  if (!parsed) {
    throw new Error(`Invalid @byline/cli package version: ${cliVersion}`)
  }

  return {
    dependencyRange: `^${parsed.version}`,
    supportedRange: `>=${parsed.version} <${parsed.major + 1}.0.0-0`,
    displayFloor: `${parsed.major}.${parsed.minor}.x+`,
  }
}

const require = createRequire(import.meta.url)

/** Version of the installed CLI package; Changesets updates this at release time. */
export const CLI_PACKAGE_VERSION = (require('../../package.json') as { version: string }).version

/** Active compatibility policy for this exact CLI artifact. */
export const BYLINE_RELEASE_POLICY = deriveBylineReleasePolicy(CLI_PACKAGE_VERSION)
