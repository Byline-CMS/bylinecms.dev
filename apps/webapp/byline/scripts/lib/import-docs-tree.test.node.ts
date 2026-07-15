import { describe, expect, it, vi } from 'vitest'

import { exitImportDocsWithFailure } from './import-docs-cli.js'
import {
  type ImportedTreeDocument,
  type ImportTreeHandle,
  placeTreeFromDirectories,
} from './import-docs-tree.js'

function createTreeHandle() {
  const groups = new Map<string, string[]>()
  const parents = new Map<string, string | null>()
  const placeTreeNode = vi.fn<ImportTreeHandle['placeTreeNode']>(
    async (documentId, { parentDocumentId, beforeDocumentId }) => {
      const previousParent = parents.get(documentId)
      if (parents.has(documentId)) {
        const previousGroup = groups.get(previousParent ?? '__root__') ?? []
        groups.set(
          previousParent ?? '__root__',
          previousGroup.filter((id) => id !== documentId)
        )
      }
      const groupKey = parentDocumentId ?? '__root__'
      const group = (groups.get(groupKey) ?? []).filter((id) => id !== documentId)
      const index = beforeDocumentId == null ? group.length : group.indexOf(beforeDocumentId) + 1
      group.splice(index, 0, documentId)
      groups.set(groupKey, group)
      parents.set(documentId, parentDocumentId)
    }
  )
  return { handle: { placeTreeNode }, placeTreeNode, groups, parents }
}

const documents: ImportedTreeDocument[] = [
  { filePath: '/docs/index.md', documentId: 'root', path: '/root' },
  { filePath: '/docs/guide/index.md', documentId: 'guide', path: '/guide' },
  { filePath: '/docs/guide/02-second.md', documentId: 'second', path: '/second' },
  { filePath: '/docs/guide/01-first.md', documentId: 'first', path: '/first' },
]

const quietLogger = { log: vi.fn(), error: vi.fn() }

describe('import docs tree placement', () => {
  it('places shuffled input in deterministic source order', async () => {
    const { handle, groups } = createTreeHandle()

    await placeTreeFromDirectories(
      handle,
      [documents[2], documents[0], documents[3], documents[1]],
      quietLogger
    )

    expect(groups.get('__root__')).toEqual(['root'])
    expect(groups.get('root')).toEqual(['guide'])
    expect(groups.get('guide')).toEqual(['first', 'second'])
  })

  it('is idempotent when the same layout is applied again', async () => {
    const { handle, groups } = createTreeHandle()

    await placeTreeFromDirectories(handle, documents, quietLogger)
    await placeTreeFromDirectories(handle, documents, quietLogger)

    expect(groups.get('__root__')).toEqual(['root'])
    expect(groups.get('root')).toEqual(['guide'])
    expect(groups.get('guide')).toEqual(['first', 'second'])
  })

  it('reparents a document when its source file moves folders', async () => {
    const { handle, groups, parents } = createTreeHandle()
    const initial = [
      { filePath: '/docs/a/index.md', documentId: 'a', path: '/a' },
      { filePath: '/docs/b/index.md', documentId: 'b', path: '/b' },
      { filePath: '/docs/a/child.md', documentId: 'child', path: '/child' },
    ]

    await placeTreeFromDirectories(handle, initial, quietLogger)
    await placeTreeFromDirectories(
      handle,
      initial.map((document) =>
        document.documentId === 'child' ? { ...document, filePath: '/docs/b/child.md' } : document
      ),
      quietLogger
    )

    expect(parents.get('child')).toBe('b')
    expect(groups.get('a')).toEqual([])
    expect(groups.get('b')).toEqual(['child'])
  })

  it('resolves index.markdown parents at every level', async () => {
    const { handle, groups } = createTreeHandle()
    const longExtensionDocuments: ImportedTreeDocument[] = [
      { filePath: '/docs/index.markdown', documentId: 'root', path: '/root' },
      { filePath: '/docs/guide/index.markdown', documentId: 'guide', path: '/guide' },
      { filePath: '/docs/guide/child.md', documentId: 'child', path: '/child' },
    ]

    await placeTreeFromDirectories(handle, longExtensionDocuments, quietLogger)

    expect(groups.get('__root__')).toEqual(['root'])
    expect(groups.get('root')).toEqual(['guide'])
    expect(groups.get('guide')).toEqual(['child'])
  })

  it('propagates placement failures after reporting the tree summary', async () => {
    const failure = new Error('stale placement')
    const handle: ImportTreeHandle = {
      placeTreeNode: vi.fn().mockRejectedValue(failure),
    }
    const logger = { log: vi.fn(), error: vi.fn() }

    await expect(placeTreeFromDirectories(handle, [documents[0]], logger)).rejects.toThrow(
      '1 tree placement(s) failed'
    )
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('stale placement'))
    expect(logger.log).toHaveBeenLastCalledWith(expect.stringContaining('1 failed'))
  })

  it('exits the CLI unsuccessfully when tree placement failure reaches the fatal handler', () => {
    const error = new AggregateError([new Error('stale placement')], 'tree placement failed')
    const io = { error: vi.fn(), exit: vi.fn() }

    exitImportDocsWithFailure(error, io)

    expect(io.error).toHaveBeenNthCalledWith(1, 'import-docs: fatal error')
    expect(io.error).toHaveBeenNthCalledWith(2, error)
    expect(io.exit).toHaveBeenCalledWith(1)
  })
})
