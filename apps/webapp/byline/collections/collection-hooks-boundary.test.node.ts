/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Source-graph regression coverage for the boundary between portable
 * collection configuration and server-only lifecycle code.
 *
 * This test protects three guarantees:
 *
 * 1. Collection schemas remain framework-independent: they do not import
 *    TanStack Start, `createServerOnlyFn`, or lifecycle-hook modules.
 * 2. The collection tuple and public configuration remain client-safe. Starting
 *    from `collections/index.ts` or `byline/public.ts` and following every
 *    ordinary `import` and re-export must never lead to lifecycle hooks, the
 *    server-only app clients, or application cache implementations. These entry
 *    points are consumed by browser-facing configuration, so one accidental
 *    static import could make Node-only code load during development or enter a
 *    client build. Server hooks instead remain reachable only through the lazy
 *    registry imported by the server bootstrap.
 * 3. The server configuration does reach the server hook registry, ensuring
 *    lifecycle hooks are registered during server bootstrap.
 *
 * This complements the production Vite build guard rather than duplicating
 * it. The Vite guard checks the emitted browser bundle, whereas this test
 * checks the source/import graph used during development and SSR. Production
 * tree-shaking can remove an accidentally imported server module and allow the
 * bundle guard to pass even though the development server still evaluates that
 * import. Keeping both checks protects the boundary in both environments.
 *
 * This test currently lives beside the collection definitions because that
 * makes the boundary it protects easy to find while the v4 structure settles.
 * We may move application architecture tests to a dedicated test directory in
 * the future, but keeping it under `byline/collections` is the clearest location
 * for now.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const collectionsDirectory = dirname(fileURLToPath(import.meta.url))
const bylineDirectory = resolve(collectionsDirectory, '..')
const appDirectory = resolve(bylineDirectory, '..')
const collectionNames = readdirSync(collectionsDirectory, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(resolve(collectionsDirectory, entry.name, 'schema.ts'))
  )
  .map((entry) => entry.name)
  .sort()

if (collectionNames.length === 0) {
  throw new Error(`No collection schema directories found under ${collectionsDirectory}`)
}

function staticModuleSpecifiers(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf8')
  const specifiers = new Set<string>()
  const staticDeclarationPatterns = [
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s+(?!\()[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*export\s+(?:type\s+)?(?:\{|\*)[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/gm,
  ]

  for (const pattern of staticDeclarationPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] != null) specifiers.add(match[1])
    }
  }

  return [...specifiers]
}

function resolveSourceImport(fromFile: string, specifier: string): string | undefined {
  let unresolved: string
  if (specifier.startsWith('.')) unresolved = resolve(dirname(fromFile), specifier)
  else if (specifier.startsWith('~/')) unresolved = resolve(bylineDirectory, specifier.slice(2))
  else if (specifier.startsWith('@/')) unresolved = resolve(appDirectory, 'src', specifier.slice(2))
  else return undefined

  const extension = extname(unresolved)
  const base = extension === '.js' ? unresolved.slice(0, -3) : unresolved
  const candidates = extension
    ? [unresolved, `${base}.ts`, `${base}.tsx`]
    : [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]
  return candidates.find((candidate) => existsSync(candidate))
}

function collectStaticSourceGraph(entryPoints: string[]): Set<string> {
  const graph = new Set<string>()
  const pending = [...entryPoints]

  while (pending.length > 0) {
    const filePath = pending.pop()
    if (filePath == null || graph.has(filePath)) continue
    graph.add(filePath)

    for (const specifier of staticModuleSpecifiers(filePath)) {
      const dependency = resolveSourceImport(filePath, specifier)
      if (dependency != null && !graph.has(dependency)) pending.push(dependency)
    }
  }

  return graph
}

describe('collection hook boundary', () => {
  it.each(collectionNames)(
    '%s schema has no framework or lifecycle-hook module dependency',
    (name) => {
      const schemaPath = resolve(collectionsDirectory, name, 'schema.ts')
      const source = readFileSync(schemaPath, 'utf8')

      expect(source).not.toContain('@tanstack/react-start')
      expect(source).not.toContain('createServerOnlyFn')
      expect(source).not.toMatch(/['"]\.\/hooks\.js['"]/)
    }
  )

  it('keeps the server-only lifecycle graph out of collection and public config graphs', () => {
    const graph = collectStaticSourceGraph([
      resolve(collectionsDirectory, 'index.ts'),
      resolve(bylineDirectory, 'public.ts'),
    ])
    const serverOnlyModules = [
      resolve(collectionsDirectory, 'server-hooks.ts'),
      resolve(appDirectory, 'src/lib/cache/with-cache.ts'),
      ...collectionNames.map((name) => resolve(collectionsDirectory, name, 'hooks.ts')),
    ]

    expect(serverOnlyModules.filter((filePath) => graph.has(filePath))).toEqual([])

    // The server-side client getters now live in the `@byline/client/server`
    // package subpath (the walker can't traverse into packages), so guard the
    // boundary at the specifier level: nothing in these client-safe graphs may
    // import it statically.
    const serverImporters = [...graph].filter((filePath) =>
      staticModuleSpecifiers(filePath).includes('@byline/client/server')
    )
    expect(serverImporters).toEqual([])
  })

  it('reaches the server hook registry only from the server bootstrap graph', () => {
    const serverHooks = resolve(collectionsDirectory, 'server-hooks.ts')
    const graph = collectStaticSourceGraph([resolve(bylineDirectory, 'server.config.ts')])

    expect(graph.has(serverHooks)).toBe(true)
  })
})
