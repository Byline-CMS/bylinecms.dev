import { mysqlProvisioner } from './mysql.js'
import { postgresProvisioner } from './postgres.js'
import type { DatabaseAdapterId } from '../../types.js'
import type { Logger } from '../../ui/logger.js'

export interface DbTargetInspection {
  exists: boolean
  objects: string[]
}

export interface ProvisionArgs {
  adminUrl: string
  database: string
  user: string
  password: string
  reset: boolean
  logger: Pick<Logger, 'step' | 'success'>
}

export interface BaselineArgs {
  applicationUrl: string
  migrationsFolder: string
  logger: Pick<Logger, 'step' | 'success'>
}

export interface DbProvisioner {
  readonly adapter: DatabaseAdapterId
  verifyAdminConnection(adminUrl: string): Promise<string>
  inspectTarget(adminUrl: string, database: string): Promise<DbTargetInspection>
  provisionTarget(args: ProvisionArgs): Promise<void>
  applyBaseline(args: BaselineArgs): Promise<void>
}

export type DatabaseProvisionerRegistry = Readonly<Record<DatabaseAdapterId, DbProvisioner>>

export const DATABASE_PROVISIONERS = {
  postgres: postgresProvisioner,
  mysql: mysqlProvisioner,
} as const satisfies DatabaseProvisionerRegistry

export function databaseProvisioner(
  adapter: DatabaseAdapterId,
  registry: DatabaseProvisionerRegistry = DATABASE_PROVISIONERS
): DbProvisioner {
  return registry[adapter]
}

const IDENTIFIER_START = '[a-z_]'
const IDENTIFIER_REST = '[a-z0-9_]'

export function isValidDatabaseIdentifier(
  adapter: DatabaseAdapterId,
  kind: 'database' | 'user',
  value: string
): boolean {
  const maxLength = adapter === 'mysql' ? (kind === 'user' ? 32 : 64) : 63
  return new RegExp(`^${IDENTIFIER_START}${IDENTIFIER_REST}{0,${maxLength - 1}}$`).test(value)
}

export function databaseIdentifierRequirement(
  adapter: DatabaseAdapterId,
  kind: 'database' | 'user'
): string {
  const maxLength = adapter === 'mysql' ? (kind === 'user' ? 32 : 64) : 63
  return `lowercase letters, digits, and underscores; start with a letter or underscore; max ${maxLength} characters`
}
