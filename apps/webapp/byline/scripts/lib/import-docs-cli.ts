export interface ImportDocsFlags {
  dryRun: boolean
  verbose: boolean
  tree: boolean
  patterns: string[]
}

export function parseImportDocsFlags(argv: string[]): ImportDocsFlags {
  const flags: ImportDocsFlags = { dryRun: false, verbose: false, tree: false, patterns: [] }
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--verbose') flags.verbose = true
    else if (arg === '--tree') flags.tree = true
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`)
    else flags.patterns.push(arg)
  }
  if (flags.patterns.length === 0) {
    throw new Error('import-docs: provide at least one file path or glob (e.g. "docs/**/*.md")')
  }
  return flags
}

export interface ImportDocsFatalIo {
  error(value: unknown): void
  exit(code: number): void
}

/** Report an uncaught importer failure and terminate the CLI unsuccessfully. */
export function exitImportDocsWithFailure(error: unknown, io: ImportDocsFatalIo): void {
  io.error('import-docs: fatal error')
  io.error(error)
  io.exit(1)
}
