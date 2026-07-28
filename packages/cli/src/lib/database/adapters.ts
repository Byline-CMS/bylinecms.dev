import type { DatabaseAdapterId } from '../../types.js'

export interface DatabaseAdapterDefinition {
  id: DatabaseAdapterId
  label: string
  packageName: `@byline/db-${string}`
  adminPackageName: `@byline/db-${string}/admin`
  searchPackageName: `@byline/search-${string}`
  connectionEnvKey: `BYLINE_DB_${string}_CONNECTION_STRING`
  preferredProtocol: string
  acceptedProtocols: readonly string[]
  defaultPort: number
  defaultAdminDatabase: string
  baseline: 'drizzle-sql' | 'none'
}

/**
 * Database adapter metadata consumed across flags, dependency/environment
 * manifests, URL handling, templates, and provisioner registration.
 *
 * Adding an adapter starts here. The `Record` exhaustiveness check ensures a
 * newly-added `DatabaseAdapterId` cannot omit its cross-CLI metadata.
 */
export const DATABASE_ADAPTERS = {
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    packageName: '@byline/db-postgres',
    adminPackageName: '@byline/db-postgres/admin',
    searchPackageName: '@byline/search-postgres',
    connectionEnvKey: 'BYLINE_DB_POSTGRES_CONNECTION_STRING',
    preferredProtocol: 'postgresql',
    acceptedProtocols: ['postgres:', 'postgresql:'],
    defaultPort: 5432,
    defaultAdminDatabase: 'postgres',
    baseline: 'drizzle-sql',
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    packageName: '@byline/db-mysql',
    adminPackageName: '@byline/db-mysql/admin',
    searchPackageName: '@byline/search-mysql',
    connectionEnvKey: 'BYLINE_DB_MYSQL_CONNECTION_STRING',
    preferredProtocol: 'mysql',
    acceptedProtocols: ['mysql:'],
    defaultPort: 3306,
    defaultAdminDatabase: 'mysql',
    baseline: 'drizzle-sql',
  },
} as const satisfies Record<DatabaseAdapterId, DatabaseAdapterDefinition>

export const DATABASE_ADAPTER_IDS = Object.freeze(
  Object.keys(DATABASE_ADAPTERS) as DatabaseAdapterId[]
)

export function databaseAdapterDefinition(
  id: DatabaseAdapterId
): (typeof DATABASE_ADAPTERS)[DatabaseAdapterId] {
  return DATABASE_ADAPTERS[id]
}
