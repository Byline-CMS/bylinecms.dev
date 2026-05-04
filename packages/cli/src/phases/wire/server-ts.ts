import { existsSync, readFileSync } from 'node:fs'

import { Project, type SourceFile } from 'ts-morph'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'src/server.ts'
const IMPORT_SPECIFIER = '../byline/server.config'
const SNIPPET = `// Initialize Byline server config (DB adapter, etc.) before handling any requests.
import '${IMPORT_SPECIFIER}'
`

export const wireServerTs: SubEdit = {
  key: 'server-ts',
  title: `Inject side-effect import into ${REL}`,
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
  if (hasImport(text, IMPORT_SPECIFIER)) {
    return { status: 'skipped', message: `${REL}: side-effect import already present` }
  }

  if (dryRun) {
    return { status: 'done', message: `${REL}: will inject \`import '${IMPORT_SPECIFIER}'\`` }
  }

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  let source: SourceFile
  try {
    source = project.addSourceFileAtPath(path)
  } catch (_e) {
    return {
      status: 'manual',
      message: `${REL}: could not parse — please add the import manually`,
      snippet: SNIPPET,
    }
  }

  // Place the side-effect import at the very top of the imports block so the
  // Byline runtime is registered before any other module side effects fire.
  source.insertImportDeclaration(0, { moduleSpecifier: IMPORT_SPECIFIER })
  source.saveSync()

  return { status: 'done', message: `${REL}: injected \`import '${IMPORT_SPECIFIER}'\`` }
}

function hasImport(source: string, specifier: string): boolean {
  // Match either form: with or without `.ts` extension, single or double quote.
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`import\\s+['"]${escaped}(?:\\.ts)?['"]`)
  return re.test(source)
}
