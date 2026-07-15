/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const collectionsDirectory = dirname(fileURLToPath(import.meta.url))
const bylineDirectory = resolve(collectionsDirectory, '..')
const appDirectory = resolve(bylineDirectory, '..')

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

describe('public collection hook boundary', () => {
  it.each([
    'docs',
    'media',
    'news',
    'news-categories',
    'pages',
  ])('%s schema keeps lifecycle hooks behind a server-only loader', (name) => {
    const schemaPath = resolve(collectionsDirectory, name, 'schema.ts')
    const source = readFileSync(schemaPath, 'utf8')

    expect(source).toMatch(
      /const loadHooks\s*=\s*createServerOnlyFn\(\(\)\s*=>\s*import\(['"]\.\/hooks\.js['"]\)\)/
    )
    expect(source).toMatch(/hooks:\s*loadHooks/)
    expect(staticModuleSpecifiers(schemaPath)).not.toContain('./hooks.js')
  })

  it('keeps the server-only lifecycle graph out of collection and public config graphs', () => {
    const graph = collectStaticSourceGraph([
      resolve(collectionsDirectory, 'index.ts'),
      resolve(bylineDirectory, 'public.ts'),
    ])
    const serverOnlyModules = [
      resolve(collectionsDirectory, 'create-public-lifecycle-hooks.ts'),
      resolve(collectionsDirectory, 'run-side-effects.ts'),
      resolve(bylineDirectory, 'client.server.ts'),
      resolve(appDirectory, 'src/lib/cache/with-cache.ts'),
      ...['docs', 'news', 'pages'].map((name) => resolve(collectionsDirectory, name, 'hooks.ts')),
    ]

    expect(serverOnlyModules.filter((filePath) => graph.has(filePath))).toEqual([])
  })
})
