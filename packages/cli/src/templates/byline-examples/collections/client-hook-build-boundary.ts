import type { Plugin } from 'vite'

const COLLECTION_HOOK_MODULE = /\/byline\/collections\/[^/]+\/hooks\.[cm]?[jt]sx?$/
const SHARED_HOOK_MODULE =
  /\/byline\/collections\/[^/]*(?:server-hooks|lifecycle-hooks|side-effects)\.[cm]?[jt]sx?$/

export function findServerHookModules(moduleIds: Iterable<string>): string[] {
  return [...moduleIds].filter((moduleId) => {
    const normalized = moduleId.replaceAll('\\', '/').split('?', 1)[0]
    return COLLECTION_HOOK_MODULE.test(normalized) || SHARED_HOOK_MODULE.test(normalized)
  })
}

/** Fail production client builds if a server lifecycle implementation re-enters the graph. */
export function clientHookBuildBoundary(): Plugin {
  return {
    name: 'byline:client-hook-build-boundary',
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
