/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Browser-safety guard for the `@byline/core` root entry.
 *
 * The root entry reaches browser bundles, so its module graph must not gain a Node
 * built-in. Host framework protections such as `.server.*` file rules do not cover
 * a published package, so the package checks itself here, against built output.
 *
 * Exactly one exception exists: `lib/logger.js` attempts a dynamic
 * `import('node:async_hooks')` inside `try`/`catch` and falls back to a no-op store.
 * The exception names the file, the specifier and the dynamic form together. A
 * dynamic import is not safe merely because it is dynamic, and a static import of
 * the same module in the same file would remove the fallback.
 *
 * Build `@byline/core` before running this test: it reads `dist`, so only a fresh build
 * makes its result current. It fails when `dist/index.js` is missing or when the graph
 * does not reach the extraction modules, but it is not a general stale-build detector.
 *
 * Its limits: it is a text walk rather than a parser, so it cannot see a computed
 * `import(name)` or a template literal with a substitution, and it stops at package
 * boundaries. It errs towards reporting: text in a string that looks like an import
 * counts as one.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

interface GraphImport {
  /** Path of the importing file, relative to the entry's directory, with `/`. */
  file: string
  specifier: string
  form: 'static' | 'dynamic'
}

const STATIC_IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]/g
// The specifier may be any literal whose value is known statically: a quoted string, or
// a template literal with no substitution. A second argument may follow it.
const DYNAMIC_IMPORT =
  /\b(?:import|require)\(\s*(?:'([^']+)'|"([^"]+)"|`((?:[^`$]|\$(?!\{))+)`)\s*[,)]/g

const BUILTINS = new Set(builtinModules)

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0] ?? specifier)
}

/**
 * Removes comments, because built output keeps JSDoc whose examples can contain import
 * expressions. It leaves string and template contents alone. A quoted string ends at
 * its line break, so a quote inside a regular expression cannot hide later lines.
 */
function stripComments(source: string): string {
  let output = ''
  let i = 0
  while (i < source.length) {
    const char = source[i] as string
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (char === "'" || char === '"' || char === '`') {
      let end = i + 1
      while (end < source.length && source[end] !== char) {
        if (char !== '`' && source[end] === '\n') break
        end += source[end] === '\\' ? 2 : 1
      }
      output += source.slice(i, end + 1)
      i = end + 1
    } else {
      output += char
      i += 1
    }
  }
  return output
}

/** Walks every relative static and dynamic import reachable from an entry file. */
function walkGraph(entry: string): { files: string[]; builtinImports: GraphImport[] } {
  const root = dirname(entry)
  const seen = new Set<string>()
  const builtinImports: GraphImport[] = []

  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const source = stripComments(readFileSync(file, 'utf8'))
    const name = relative(root, file).split(sep).join('/')
    const scan = (pattern: RegExp, form: GraphImport['form']): void => {
      for (const match of source.matchAll(pattern)) {
        const specifier = (match[1] ?? match[2] ?? match[3]) as string
        if (specifier.startsWith('.')) {
          visit(resolve(dirname(file), specifier))
        } else if (isNodeBuiltin(specifier)) {
          builtinImports.push({ file: name, specifier, form })
        }
      }
    }
    scan(STATIC_IMPORT, 'static')
    scan(DYNAMIC_IMPORT, 'dynamic')
  }
  visit(entry)

  return {
    files: [...seen].map((file) => relative(root, file).split(sep).join('/')),
    builtinImports,
  }
}

const ALLOWED: readonly GraphImport[] = [
  { file: 'lib/logger.js', specifier: 'node:async_hooks', form: 'dynamic' },
]

const sameImport = (a: GraphImport, b: GraphImport): boolean =>
  a.file === b.file && a.specifier === b.specifier && a.form === b.form

/** Every failure the guard reports for a graph. */
function guardViolations(
  builtinImports: readonly GraphImport[],
  allowed: readonly GraphImport[] = ALLOWED
): string[] {
  const unexpected = builtinImports
    .filter((found) => !allowed.some((entry) => sameImport(entry, found)))
    .map((found) => `${found.file}: ${found.form} import of ${found.specifier}`)
  const stale = allowed
    .filter((entry) => !builtinImports.some((found) => sameImport(entry, found)))
    .map((entry) => `stale allowlist entry: ${entry.file} ${entry.form} ${entry.specifier}`)
  return [...unexpected, ...stale]
}

describe('root graph guard', () => {
  const temporaryDirectories: string[] = []

  /** Writes a small built tree and returns the path of its `index.js`. */
  function fixture(files: Record<string, string>): string {
    const directory = mkdtempSync(join(tmpdir(), 'byline-root-guard-'))
    temporaryDirectories.push(directory)
    for (const [name, source] of Object.entries(files)) {
      const path = join(directory, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, source)
    }
    return join(directory, 'index.js')
  }

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  const LOGGER = "try { await import('node:async_hooks') } catch {}\n"

  describe('self-test', () => {
    it('passes a tree with only the allowlisted import', () => {
      const { builtinImports } = walkGraph(
        fixture({ 'index.js': "export * from './lib/logger.js'\n", 'lib/logger.js': LOGGER })
      )

      expect(guardViolations(builtinImports)).toEqual([])
    })

    it('catches a planted static import', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': "export * from './lib/logger.js'\nexport { x } from './a/b.js'\n",
          'lib/logger.js': LOGGER,
          'a/b.js': "import { readFile } from 'node:fs/promises'\nexport const x = readFile\n",
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['a/b.js: static import of node:fs/promises'])
    })

    it('catches a planted dynamic import', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': "export * from './lib/logger.js'\nimport './a.js'\n",
          'lib/logger.js': LOGGER,
          'a.js': "const fs = await import('node:fs')\nexport { fs }\n",
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['a.js: dynamic import of node:fs'])
    })

    it('catches a static import of the allowlisted module in the allowlisted file', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': "export * from './lib/logger.js'\n",
          'lib/logger.js': "import { AsyncLocalStorage } from 'node:async_hooks'\n",
        })
      )

      expect(guardViolations(builtinImports)).toEqual([
        'lib/logger.js: static import of node:async_hooks',
        'stale allowlist entry: lib/logger.js dynamic node:async_hooks',
      ])
    })

    it('catches the allowlisted import in any other file', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': "export * from './lib/logger.js'\nimport './other.js'\n",
          'lib/logger.js': LOGGER,
          'other.js': "await import('node:async_hooks')\n",
        })
      )

      expect(guardViolations(builtinImports)).toEqual([
        'other.js: dynamic import of node:async_hooks',
      ])
    })

    it('catches a bare built-in with no node: prefix', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': "export * from './lib/logger.js'\nimport fs from 'fs'\nexport { fs }\n",
          'lib/logger.js': LOGGER,
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['index.js: static import of fs'])
    })

    it('ignores imports written in comments', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': [
            "/** Example: hooks: () => import('./missing.hooks.js') */",
            "// await import('node:fs')",
            "export * from './lib/logger.js'",
          ].join('\n'),
          'lib/logger.js': LOGGER,
        })
      )

      expect(guardViolations(builtinImports)).toEqual([])
    })

    it('still sees a real import after a string that looks like a comment', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': [
            "export * from './lib/logger.js'",
            "const url = 'https://example.com/*'",
            "const fs = await import('node:fs')",
            'export { fs, url }',
          ].join('\n'),
          'lib/logger.js': LOGGER,
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['index.js: dynamic import of node:fs'])
    })

    it('fails on a relative import that does not resolve', () => {
      expect(() => walkGraph(fixture({ 'index.js': "export * from './missing.js'\n" }))).toThrow(
        /ENOENT/
      )
    })

    it('catches a built-in named by a no-substitution template literal', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': [
            "export * from './lib/logger.js'",
            'export const read = () => import(`node:fs`)',
          ].join('\n'),
          'lib/logger.js': LOGGER,
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['index.js: dynamic import of node:fs'])
    })

    it('follows a relative template literal import to a built-in one hop away', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': [
            "export * from './lib/logger.js'",
            'export const load = () => import(`./hidden.js`)',
          ].join('\n'),
          'lib/logger.js': LOGGER,
          'hidden.js': "import fs from 'node:fs'\nexport { fs }\n",
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['hidden.js: static import of node:fs'])
    })

    it('catches a dynamic import with an options argument', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': [
            "export * from './lib/logger.js'",
            "export const load = () => import('node:fs', { with: {} })",
          ].join('\n'),
          'lib/logger.js': LOGGER,
        })
      )

      expect(guardViolations(builtinImports)).toEqual(['index.js: dynamic import of node:fs'])
    })

    it('does not treat a template literal with a substitution as a known specifier', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': 'export const load = (name) => import(`./${name}.js`)\n',
        })
      )

      expect(builtinImports).toEqual([])
    })

    it('errs towards reporting text in a string that looks like an import', () => {
      const { builtinImports } = walkGraph(
        fixture({
          'index.js': "export const help = 'write import(`node:fs`) in your own code'\n",
        })
      )

      expect(builtinImports.map((found) => found.specifier)).toEqual(['node:fs'])
    })

    it('reports an allowlist entry that no longer matches', () => {
      const { builtinImports } = walkGraph(fixture({ 'index.js': 'export const x = 1\n' }))

      expect(guardViolations(builtinImports)).toEqual([
        'stale allowlist entry: lib/logger.js dynamic node:async_hooks',
      ])
    })

    it('does not treat a package with a built-in-like suffix as a built-in', () => {
      const { builtinImports } = walkGraph(
        fixture({ 'index.js': "import x from 'fs-extra'\nexport { x }\n" })
      )

      expect(builtinImports).toEqual([])
    })
  })

  describe('the built @byline/core root entry', () => {
    const entry = fileURLToPath(new URL('../../dist/index.js', import.meta.url))

    it('exists; build @byline/core before running this test', () => {
      expect(existsSync(entry)).toBe(true)
    })

    it('reaches the extraction modules', () => {
      const { files } = walkGraph(entry)

      expect(files).toEqual(
        expect.arrayContaining([
          'extraction/artifact.js',
          'extraction/errors.js',
          'extraction/evidence.js',
          'extraction/outcomes.js',
          'extraction/page-map.js',
          'extraction/producer.js',
          'extraction/work.js',
        ])
      )
    })

    it('holds no Node built-in beyond the allowlisted dynamic import', () => {
      expect(guardViolations(walkGraph(entry).builtinImports)).toEqual([])
    })
  })
})
