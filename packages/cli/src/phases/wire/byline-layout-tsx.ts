import { existsSync, readFileSync } from 'node:fs'

import { Project, type SourceFile } from 'ts-morph'

import type { Context } from '../../context.js'
import type { SubEdit, SubEditResult } from './shared.js'

const REL = 'src/routes/_byline/route.tsx'
const IMPORT_SPECIFIER = '../../../byline/admin.config'
const SNIPPET = `// Initialize Byline admin config — scoped to the _byline layout so the
// Lexical editor module graph stays out of public-route bundles.
// See byline/admin.config.ts for the comment on why this is side-effecty.
import '${IMPORT_SPECIFIER}'
`

export const wireBylineLayoutTsx: SubEdit = {
  key: 'byline-layout-tsx',
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
    return { status: 'blocked', message: `${REL} not found — routes phase should have caught this` }
  }

  const text = readFileSync(path, 'utf8')
  if (hasImport(text, IMPORT_SPECIFIER)) {
    return { status: 'skipped', message: `${REL}: admin config import already present` }
  }

  if (dryRun) {
    return { status: 'done', message: `${REL}: will inject \`import '${IMPORT_SPECIFIER}'\`` }
  }

  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true })
  let source: SourceFile
  try {
    source = project.addSourceFileAtPath(path)
  } catch {
    return {
      status: 'manual',
      message: `${REL}: could not parse — please add the import manually`,
      snippet: SNIPPET,
    }
  }

  // Place after the last existing import — admin config registration only
  // needs to run once at module load; ordering with other side-effect
  // imports doesn't matter as long as it lands in the route module graph.
  const imports = source.getImportDeclarations()
  const insertIndex = imports.length
  source.insertImportDeclaration(insertIndex, { moduleSpecifier: IMPORT_SPECIFIER })
  source.saveSync()

  return { status: 'done', message: `${REL}: injected \`import '${IMPORT_SPECIFIER}'\`` }
}

function hasImport(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`import\\s+['"]${escaped}(?:\\.ts|\\.tsx)?['"]`)
  return re.test(source)
}
