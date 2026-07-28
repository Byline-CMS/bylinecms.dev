import { databaseAdapterDefinition } from './adapters.js'
import type { DbDialect } from '../../types.js'

export interface DbConnectionParts {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export function defaultDbPort(dialect: DbDialect): number {
  return databaseAdapterDefinition(dialect).defaultPort
}

export function buildDbUrl(dialect: DbDialect, connection: DbConnectionParts): string {
  const protocol = databaseAdapterDefinition(dialect).preferredProtocol
  const user = encodeURIComponent(connection.user)
  const password = encodeURIComponent(connection.password)
  const database = encodeURIComponent(connection.database)
  return `${protocol}://${user}:${password}@${connection.host}:${connection.port}/${database}`
}

export function parseDbUrl(raw: string, dialect: DbDialect): DbConnectionParts {
  const url = new URL(raw)
  const adapter = databaseAdapterDefinition(dialect)
  if (!(adapter.acceptedProtocols as readonly string[]).includes(url.protocol)) {
    throw new Error(`expected ${dialect} connection URL, got ${url.protocol}`)
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : defaultDbPort(dialect),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  }
}

export function withDbDatabase(connection: DbConnectionParts, database: string): DbConnectionParts {
  return { ...connection, database }
}
