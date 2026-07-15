import { basename, dirname, join } from 'node:path'

export interface ImportedTreeDocument {
  filePath: string
  documentId?: string
  path: string
}

export interface ImportTreeHandle {
  placeTreeNode(
    documentId: string,
    options: { parentDocumentId: string | null; beforeDocumentId: string | null }
  ): Promise<unknown>
}

export interface ImportTreeLogger {
  log(message: string): void
  error(message: string): void
}

export interface ImportTreeSummary {
  rooted: number
  placed: number
  failed: number
}

function parentIndexFiles(filePath: string): [string, string] {
  const dir = dirname(filePath)
  const base = basename(filePath)
  const parentDir = base === 'index.md' || base === 'index.markdown' ? dirname(dir) : dir
  return [join(parentDir, 'index.md'), join(parentDir, 'index.markdown')]
}

/** Place imported documents from their folder/index layout in stable source order. */
export async function placeTreeFromDirectories(
  handle: ImportTreeHandle,
  results: readonly ImportedTreeDocument[],
  logger: ImportTreeLogger = console
): Promise<ImportTreeSummary> {
  const placeable = results
    .filter(
      (result): result is ImportedTreeDocument & { documentId: string } => result.documentId != null
    )
    .toSorted((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0))
  const idByFile = new Map(placeable.map((result) => [result.filePath, result.documentId]))

  const ROOT_GROUP = '__root__'
  const lastSiblingByGroup = new Map<string, string>()
  const errors: unknown[] = []
  let rooted = 0
  let placed = 0

  for (const result of placeable) {
    const [markdownIndex, longMarkdownIndex] = parentIndexFiles(result.filePath)
    const parentId = idByFile.get(markdownIndex) ?? idByFile.get(longMarkdownIndex)
    const parentDocumentId = parentId != null && parentId !== result.documentId ? parentId : null
    const groupKey = parentDocumentId ?? ROOT_GROUP
    const beforeDocumentId = lastSiblingByGroup.get(groupKey) ?? null
    try {
      await handle.placeTreeNode(result.documentId, { parentDocumentId, beforeDocumentId })
      lastSiblingByGroup.set(groupKey, result.documentId)
      if (parentDocumentId != null) {
        placed += 1
        logger.log(`  ↳ placed   ${result.path}  under  ${basename(dirname(result.filePath))}`)
      } else {
        rooted += 1
      }
    } catch (error) {
      errors.push(error)
      logger.error(
        `  ✗ tree     ${result.path}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const summary = { rooted, placed, failed: errors.length }
  logger.log(
    `import-docs: tree — ${summary.rooted} root(s), ${summary.placed} child placement(s), ${summary.failed} failed.`
  )
  if (errors.length > 0) {
    throw new AggregateError(errors, `import-docs: ${errors.length} tree placement(s) failed`)
  }
  return summary
}
