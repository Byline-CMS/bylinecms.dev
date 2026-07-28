import type { DatabaseAdapterId } from '../../types.js'
import type { DatabaseUrlCodec, DbConnectionParts } from './urls.js'

export interface DatabaseAdapterDefinition {
  id: DatabaseAdapterId
  label: string
  selectionLabel: string
  packageName: `@byline/db-${string}`
  adminPackageName: `@byline/db-${string}/admin`
  searchPackageName?: `@byline/search-${string}`
  connectionEnvKey: `BYLINE_DB_${string}_CONNECTION_STRING`
  url: DatabaseUrlCodec
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
    selectionLabel: 'PostgreSQL',
    packageName: '@byline/db-postgres',
    adminPackageName: '@byline/db-postgres/admin',
    searchPackageName: '@byline/search-postgres',
    connectionEnvKey: 'BYLINE_DB_POSTGRES_CONNECTION_STRING',
    url: singleHostUrlCodec({
      adapter: 'postgres',
      preferredProtocol: 'postgresql',
      acceptedProtocols: ['postgres:', 'postgresql:'],
      defaultPort: 5432,
    }),
    defaultAdminDatabase: 'postgres',
    baseline: 'drizzle-sql',
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    selectionLabel: 'MySQL 8.0.14 or later',
    packageName: '@byline/db-mysql',
    adminPackageName: '@byline/db-mysql/admin',
    searchPackageName: '@byline/search-mysql',
    connectionEnvKey: 'BYLINE_DB_MYSQL_CONNECTION_STRING',
    url: singleHostUrlCodec({
      adapter: 'mysql',
      preferredProtocol: 'mysql',
      acceptedProtocols: ['mysql:'],
      defaultPort: 3306,
    }),
    defaultAdminDatabase: 'mysql',
    baseline: 'drizzle-sql',
  },
} as const satisfies Record<DatabaseAdapterId, DatabaseAdapterDefinition>

export const DEFAULT_DATABASE_ADAPTER = 'postgres' satisfies DatabaseAdapterId

export const DATABASE_ADAPTER_IDS = Object.freeze([
  DEFAULT_DATABASE_ADAPTER,
  ...(Object.keys(DATABASE_ADAPTERS) as DatabaseAdapterId[]).filter(
    (id) => id !== DEFAULT_DATABASE_ADAPTER
  ),
] satisfies DatabaseAdapterId[])

export function databaseAdapterDefinition<Id extends DatabaseAdapterId>(
  id: Id
): (typeof DATABASE_ADAPTERS)[Id] {
  return DATABASE_ADAPTERS[id]
}

function singleHostUrlCodec(options: {
  adapter: DatabaseAdapterId
  preferredProtocol: string
  acceptedProtocols: readonly string[]
  defaultPort: number
}): DatabaseUrlCodec {
  return {
    acceptedProtocols: options.acceptedProtocols,
    defaultPort: options.defaultPort,

    build(connection: DbConnectionParts): string {
      const user = encodeURIComponent(connection.user)
      const password = encodeURIComponent(connection.password)
      const database = encodeURIComponent(connection.database)
      const port = connection.port ?? options.defaultPort
      const host =
        connection.host.includes(':') && !connection.host.startsWith('[')
          ? `[${connection.host}]`
          : connection.host
      return `${options.preferredProtocol}://${user}:${password}@${host}:${port}/${database}`
    },

    parse(raw: string): DbConnectionParts {
      const url = new URL(raw)
      if (!options.acceptedProtocols.includes(url.protocol)) {
        throw new Error(`expected ${options.adapter} connection URL, got ${url.protocol}`)
      }
      return {
        host: url.hostname,
        port: url.port ? Number(url.port) : options.defaultPort,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      }
    },
  }
}
