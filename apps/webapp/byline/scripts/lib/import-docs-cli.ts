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
