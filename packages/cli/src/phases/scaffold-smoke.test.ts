import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { Project, SyntaxKind } from 'ts-morph'
import { afterEach, describe, expect, it } from 'vitest'

import { DEP_SPECS } from '../manifest/deps.js'
import { createTestContext } from '../test-helpers.js'
import { buildRoutesPlan, routesPhase } from './routes.js'
import { buildScaffoldPlan, scaffoldPhase } from './scaffold.js'
import { buildUiPlan, uiPhase } from './ui.js'
import type { Context } from '../context.js'

const contexts: Context[] = []
const HOST_EXTERNALS = new Set([
  ...DEP_SPECS.map((spec) => spec.name),
  'mdast',
  'react',
  'react-dom',
  'vite',
  'vitest',
  '@tanstack/react-router',
  '@tanstack/react-start',
])

afterEach(() => {
  for (const ctx of contexts.splice(0)) rmSync(ctx.cwd, { recursive: true, force: true })
})

describe('temporary host scaffold smoke contracts', () => {
  it.each([
    { examples: true, importDocs: false },
    { examples: false, importDocs: false },
    { examples: true, importDocs: true },
  ])('assembles a locally resolvable $examples/$importDocs inventory', async (answers) => {
    const ctx = createTestContext({ ...answers, adminPath: '/admin', signInPath: '/sign-in' })
    contexts.push(ctx)
    writeFileSync(ctx.resolve('package.json'), '{"name":"smoke","scripts":{}}\n')

    const scaffold = buildScaffoldPlan(ctx)
    expect((await scaffoldPhase.apply(scaffold, ctx)).state).toBe('done')
    const routes = buildRoutesPlan(ctx)
    expect((await routesPhase.apply(routes, ctx)).state).toBe('done')
    const ui = buildUiPlan(ctx)
    expect((await uiPhase.apply(ui, ctx)).state).toBe('done')

    const sourceFiles = walkFiles(ctx.cwd).filter((path) => /\.(?:ts|tsx)$/.test(path))
    const generated = readFileSync(ctx.resolve('byline/generated/collection-types.ts'), 'utf8')
    const generatedImports = sourceFiles.flatMap((path) =>
      importedGeneratedNames(readFileSync(path, 'utf8'))
    )
    for (const name of generatedImports) {
      expect(generated, `missing generated export ${name}`).toMatch(
        new RegExp(`export (?:interface|type) ${name}\\b`)
      )
    }

    const unresolved = validateImports(ctx, sourceFiles)
    expect(unresolved).toEqual([])
    expect(sourceFiles.every((path) => !readFileSync(path, 'utf8').includes('@/i18n/'))).toBe(true)

    const inventory = sourceFiles.map((path) => relative(ctx.cwd, path).replaceAll('\\', '/'))
    expect(inventory.filter((path) => path.endsWith('.test.node.ts'))).toEqual([])
    expect(inventory.includes('byline/scripts/import-docs.ts')).toBe(answers.importDocs)
    expect(inventory.some((path) => path.startsWith('byline/scripts/lib/'))).toBe(
      answers.importDocs
    )
    expect(inventory.includes('src/ui/byline/render-blocks.tsx')).toBe(answers.examples)
    // Without examples, the only generated imports are the structural
    // registry aliases used by collections/index.ts and the contract file —
    // no collection field shapes.
    if (!answers.examples) {
      expect([...new Set(generatedImports)].sort()).toEqual([
        'CollectionFieldsAllLocalesByPath',
        'CollectionFieldsByPath',
      ])
    }
  })

  it('assembles a custom nested sign-in route fixture with matching config and route ID', async () => {
    const ctx = createTestContext({
      examples: false,
      importDocs: false,
      adminPath: '/cms',
      signInPath: '/staff/login',
    })
    contexts.push(ctx)
    writeFileSync(ctx.resolve('package.json'), '{"name":"smoke","scripts":{}}\n')

    await scaffoldPhase.apply(buildScaffoldPlan(ctx), ctx)
    expect((await routesPhase.apply(buildRoutesPlan(ctx), ctx)).state).toBe('done')

    const routePath = ctx.resolve('src/routes/_byline/staff/login.tsx')
    expect(existsSync(routePath)).toBe(true)
    expect(readFileSync(routePath, 'utf8')).toContain("createSignInRoute('/_byline/staff/login')")
    expect(readFileSync(ctx.resolve('byline/routes.ts'), 'utf8')).toContain(
      "signIn: '/staff/login'"
    )
  })
})

/**
 * A full fixture tsc would require recreating TanStack's generated route tree and declarations for
 * every host peer package. This deterministic check instead resolves every local import and makes
 * every bare import cross an explicit package/host boundary, while Vitest parses all source files.
 */
function validateImports(ctx: Context, sourceFiles: string[]): string[] {
  const unresolved: string[] = []
  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8')
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('.')) {
        if (!resolvesToFixtureFile(resolve(dirname(path), specifier))) {
          unresolved.push(`${relative(ctx.cwd, path)} -> ${specifier}`)
        }
        continue
      }
      if (specifier.startsWith('@/')) {
        if (!resolvesToFixtureFile(ctx.resolve('src', specifier.slice(2)))) {
          unresolved.push(`${relative(ctx.cwd, path)} -> ${specifier}`)
        }
        continue
      }
      if (specifier.startsWith('~/')) {
        if (!resolvesToFixtureFile(ctx.resolve('byline', specifier.slice(2)))) {
          unresolved.push(`${relative(ctx.cwd, path)} -> ${specifier}`)
        }
        continue
      }
      const boundary = packageBoundary(specifier)
      if (!HOST_EXTERNALS.has(boundary)) {
        unresolved.push(`${relative(ctx.cwd, path)} -> undeclared external ${boundary}`)
      }
    }
  }
  return unresolved.sort()
}

function importSpecifiers(source: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true })
  const file = project.createSourceFile('fixture.tsx', source)
  const staticImports = file.getImportDeclarations().map((node) => node.getModuleSpecifierValue())
  const staticExports = file
    .getExportDeclarations()
    .map((node) => node.getModuleSpecifierValue())
    .filter((value): value is string => value !== undefined)
  const dynamicImports = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((node) => node.getExpression().getKind() === SyntaxKind.ImportKeyword)
    .map((node) => node.getArguments()[0]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue())
    .filter((value): value is string => value !== undefined)
  return [...staticImports, ...staticExports, ...dynamicImports]
}

function resolvesToFixtureFile(path: string): boolean {
  const withoutJs = path.replace(/\.js$/, '')
  const candidates = [
    path,
    withoutJs,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}.css`,
    `${withoutJs}.scss`,
    resolve(withoutJs, 'index.ts'),
    resolve(withoutJs, 'index.tsx'),
  ]
  return candidates.some((candidate) => existsSync(candidate) && !statSync(candidate).isDirectory())
}

function packageBoundary(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier)
}

function importedGeneratedNames(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(
    /import type \{([^}]+)\} from ['"]@byline\/generated-types['"]/g
  )) {
    for (const item of match[1]?.split(',') ?? []) {
      const name = item.trim().split(/\s+as\s+/)[0]
      if (name) names.push(name)
    }
  }
  return names
}

function walkFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root).sort()) {
    const path = resolve(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}
