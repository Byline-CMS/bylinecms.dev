/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Production client-bundle guard for server-only Byline lifecycle modules.
 *
 * Collection schemas are isomorphic, but registered lifecycle hooks may
 * import Node APIs, caches, storage SDKs, and other server-only dependencies.
 * This Vite plugin inspects emitted client chunks and fails the build if a
 * hook implementation, server hook registry, or shared lifecycle helper
 * becomes reachable from the browser bundle.
 */
import type { Plugin } from 'vite'

const SERVER_HOOK_MODULE =
  /\/byline\/collections\/(?:.+\/)?(?:hooks|[^/]+-hooks|[^/]+-lifecycle-hooks|[^/]+-side-effects)\.[cm]?[jt]sx?$/

export function findServerHookModules(moduleIds: Iterable<string>): string[] {
  return [...moduleIds].filter((moduleId) => {
    const normalized = moduleId.replaceAll('\\', '/').split('?', 1)[0]
    return SERVER_HOOK_MODULE.test(normalized)
  })
}

export function bylineClientHookBoundary(): Plugin {
  return {
    name: 'byline:client-hook-boundary',
    generateBundle(_options, bundle) {
      if (this.environment?.name !== 'client') return
      const leaked = findServerHookModules(
        Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' ? Object.keys(output.modules) : []
        )
      )
      if (leaked.length > 0) {
        this.error(`server lifecycle modules entered the client bundle:\n${leaked.join('\n')}`)
      }
    },
  }
}
