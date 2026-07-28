import { resolve } from 'node:path'

import type { DbDialect } from '../types.js'

/**
 * Resolve the current release's fresh-install baseline for a database dialect.
 *
 * The directory contains one squashed Drizzle migration and its journal. It is
 * never an upgrade stream; existing installations use the adapters' native
 * SQL directories.
 */
export function baselineDir(templatesDir: string, dialect: DbDialect): string {
  return resolve(templatesDir, 'migrations', dialect)
}
