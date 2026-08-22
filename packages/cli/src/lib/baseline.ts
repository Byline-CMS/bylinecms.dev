import { resolve } from 'node:path'

import type { DatabaseAdapterId } from '../types.js'

/**
 * Resolve the current release's fresh-install baseline for a database dialect.
 *
 * The directory contains the current release's complete Drizzle migration
 * bundle and its journal. A release normally squashes that bundle to one SQL
 * file, but development branches may contain later migrations. It is never an
 * upgrade stream; existing installations use the adapters' native SQL
 * directories.
 */
export function baselineDir(templatesDir: string, dialect: DatabaseAdapterId): string {
  return resolve(templatesDir, 'migrations', dialect)
}
