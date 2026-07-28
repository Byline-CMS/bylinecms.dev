import { databaseAdapterDefinition } from './adapters.js'
import type { DatabaseAdapterId } from '../../types.js'

export interface DbConnectionParts {
  host: string
  port?: number
  user: string
  password: string
  database: string
}

export interface DatabaseUrlCodec {
  acceptedProtocols: readonly string[]
  defaultPort?: number
  build(connection: DbConnectionParts): string
  parse(raw: string): DbConnectionParts
}

export function defaultDbPort(adapter: DatabaseAdapterId): number | undefined {
  return databaseAdapterDefinition(adapter).url.defaultPort
}

export function buildDbUrl(adapter: DatabaseAdapterId, connection: DbConnectionParts): string {
  return databaseAdapterDefinition(adapter).url.build(connection)
}

export function parseDbUrl(raw: string, adapter: DatabaseAdapterId): DbConnectionParts {
  return databaseAdapterDefinition(adapter).url.parse(raw)
}

export function withDbDatabase(connection: DbConnectionParts, database: string): DbConnectionParts {
  return { ...connection, database }
}
