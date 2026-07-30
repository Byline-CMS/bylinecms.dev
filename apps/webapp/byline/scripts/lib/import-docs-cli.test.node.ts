import { describe, expect, it, vi } from 'vitest'

import { exitImportDocsWithFailure, parseImportDocsFlags } from './import-docs-cli.js'

describe('import docs CLI', () => {
  it('parses the supported importer flags and source patterns', () => {
    expect(parseImportDocsFlags(['docs/**/*.md', '--dry-run', '--verbose', '--tree'])).toEqual({
      dryRun: true,
      verbose: true,
      tree: true,
      patterns: ['docs/**/*.md'],
    })
  })

  it('rejects the retired deleted-document --force flag', () => {
    expect(() => parseImportDocsFlags(['docs/**/*.md', '--force'])).toThrow('unknown flag: --force')
  })

  it('requires at least one source path or glob', () => {
    expect(() => parseImportDocsFlags(['--dry-run'])).toThrow(
      'provide at least one file path or glob'
    )
  })

  it('reports an uncaught importer failure and exits unsuccessfully', () => {
    const error = new Error('tree placement failed')
    const io = { error: vi.fn(), exit: vi.fn() }

    exitImportDocsWithFailure(error, io)

    expect(io.error).toHaveBeenNthCalledWith(1, 'import-docs: fatal error')
    expect(io.error).toHaveBeenNthCalledWith(2, error)
    expect(io.exit).toHaveBeenCalledWith(1)
  })
})
