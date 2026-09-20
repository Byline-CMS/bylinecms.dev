import { createRequire } from 'node:module'

import { parse } from 'semver'

export interface BylineReleasePolicy {
  /** Range written into `package.json` when the CLI installs a `@byline/*` package. */
  dependencyRange: string
  /** Range an already-declared `@byline/*` dependency must fall within to pass the gate. */
  supportedRange: string
  /** Human-readable form of `supportedRange` for prompts and error messages. */
  displayFloor: string
}

/**
 * Derive every CLI package-compatibility value from one release version.
 *
 * Installing and accepting are deliberately different ranges. A fresh install
 * pins `^<cli version>`, because there is no reason to scaffold an app onto
 * anything but the current release. Acceptance spans the whole major line,
 * because `npx @byline/cli` always fetches the newest CLI: gating on the CLI's
 * own version would reject every app that is even one patch behind, which is
 * most of them. The `@byline/*` packages release in lockstep within a major,
 * so any release in the line is a coherent target for this CLI.
 */
export function deriveBylineReleasePolicy(cliVersion: string): BylineReleasePolicy {
  const parsed = parse(cliVersion)
  if (!parsed) {
    throw new Error(`Invalid @byline/cli package version: ${cliVersion}`)
  }

  return {
    dependencyRange: `^${parsed.version}`,
    supportedRange: `>=${parsed.major}.0.0 <${parsed.major + 1}.0.0-0`,
    displayFloor: `${parsed.major}.x`,
  }
}

const require = createRequire(import.meta.url)

/** Version of the installed CLI package; Changesets updates this at release time. */
export const CLI_PACKAGE_VERSION = (require('../../package.json') as { version: string }).version

/** Active compatibility policy for this exact CLI artifact. */
export const BYLINE_RELEASE_POLICY = deriveBylineReleasePolicy(CLI_PACKAGE_VERSION)
