import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { Project, type SourceFile, SyntaxKind } from 'ts-morph'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'src/server.ts'
const IMPORT_SPECIFIER = '../byline/server.config'
const SNIPPET = `// Initialize Byline server config (DB adapter, etc.) before handling any requests.
import '${IMPORT_SPECIFIER}'
import { getBylineCore } from '@byline/core'
import { startBylineScheduler } from '@byline/core/scheduler'
declare global {
  // biome-ignore lint: globalThis augmentation requires var rather than let
  var __bylineSchedulerController__: ReturnType<typeof startBylineScheduler> | undefined
}
globalThis.__bylineSchedulerController__ ??= startBylineScheduler(getBylineCore())
`

export const wireServerTs: SubEdit = {
  key: 'server-ts',
  title: `Initialize Byline and start its scheduler in ${REL}`,
  async preview(ctx) {
    return run(ctx, true)
  },
  async apply(ctx) {
    return run(ctx, false)
  },
}

async function run(ctx: Context, dryRun: boolean): Promise<SubEditResult> {
  const path = ctx.resolve(REL)
  if (!existsSync(path)) {
    return { status: 'blocked', message: `${REL} not found — host phase should have caught this` }
  }

  const text = readFileSync(path, 'utf8')
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true })
  let source: SourceFile
  try {
    source = project.createSourceFile('server.ts', text)
  } catch (_e) {
    return {
      status: 'manual',
      message: `${REL}: could not parse — please wire initialization and scheduler manually`,
      snippet: SNIPPET,
    }
  }

  let changed = false
  if (!hasImport(text, IMPORT_SPECIFIER)) {
    source.insertImportDeclaration(0, { moduleSpecifier: IMPORT_SPECIFIER })
    changed = true
  }
  const schedulerImport = source
    .getImportDeclarations()
    .find((declaration) => declaration.getModuleSpecifierValue() === '@byline/core/scheduler')
  const schedulerName = schedulerImport
    ?.getNamedImports()
    .find((item) => item.getName() === 'startBylineScheduler')
  const localSchedulerName =
    schedulerName?.getAliasNode()?.getText() ?? schedulerName?.getName() ?? 'startBylineScheduler'
  const alreadyStarted =
    schedulerName !== undefined &&
    source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => call.getExpression().getText() === localSchedulerName)
  if (!alreadyStarted) {
    const coreGetter = ensureImport(source, '@byline/core', 'getBylineCore')
    const scheduler = ensureImport(source, '@byline/core/scheduler', 'startBylineScheduler')
    const declaration = source
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .some((item) => item.getName() === '__bylineSchedulerController__')
    source.addStatements(`
// Host-owned lifetime: config imports from seeds/migrations remain inert.
${
  declaration
    ? ''
    : `declare global {
  // biome-ignore lint: globalThis augmentation requires var rather than let
  var __bylineSchedulerController__: ReturnType<typeof ${scheduler}> | undefined
}`
}
globalThis.__bylineSchedulerController__ ??= ${scheduler}(${coreGetter}())
`)
    changed = true
  }
  if (!changed)
    return {
      status: 'skipped',
      message: `${REL}: Byline initialization and scheduler already present`,
    }
  if (!dryRun) {
    writeFileSync(path, source.getFullText())
  }
  return {
    status: 'done',
    message: `${REL}: ${dryRun ? 'will wire' : 'wired'} Byline initialization and scheduler`,
  }
}

function ensureImport(source: SourceFile, moduleSpecifier: string, name: string): string {
  const declaration = source
    .getImportDeclarations()
    .find((item) => item.getModuleSpecifierValue() === moduleSpecifier && !item.isTypeOnly())
  const existing = declaration?.getNamedImports().find((item) => item.getName() === name)
  if (existing) return existing.getAliasNode()?.getText() ?? existing.getName()
  if (declaration) declaration.addNamedImport(name)
  else source.addImportDeclaration({ moduleSpecifier, namedImports: [name] })
  return name
}

function hasImport(source: string, specifier: string): boolean {
  // Match either form: with or without `.ts` extension, single or double quote.
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`import\\s+['"]${escaped}(?:\\.ts)?['"]`)
  return re.test(source)
}
