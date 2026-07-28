import { DATABASE_ADAPTER_IDS, DATABASE_ADAPTERS } from './adapters.js'
import type { Context } from '../../context.js'
import type { DbDialect } from '../../types.js'

export const DB_DIALECTS = DATABASE_ADAPTER_IDS

export interface DbDialectInspection {
  state: 'resolved' | 'pending' | 'blocked'
  dialect?: DbDialect
  reason?: string
}

export function isDbDialect(value: unknown): value is DbDialect {
  return typeof value === 'string' && (DB_DIALECTS as readonly string[]).includes(value)
}

export function inspectDbDialect(ctx: Context): DbDialectInspection {
  const persisted = ctx.state.get().answers.dbDialect
  const requested = ctx.cliFlags.database

  if (requested !== undefined && !isDbDialect(requested)) {
    return {
      state: 'blocked',
      reason: `invalid database dialect "${String(requested)}"; expected ${DB_DIALECTS.join(' or ')}`,
    }
  }
  if (persisted !== undefined && !isDbDialect(persisted)) {
    return {
      state: 'blocked',
      reason: `persisted database dialect "${String(persisted)}" is invalid`,
    }
  }
  if (persisted && requested && persisted !== requested) {
    return {
      state: 'blocked',
      reason:
        `this installation is already configured for ${persisted}; ` +
        `changing it to ${requested} is a data migration, not an installer re-run`,
    }
  }
  const dialect = persisted ?? requested
  return dialect ? { state: 'resolved', dialect } : { state: 'pending' }
}

export async function resolveDbDialect(ctx: Context): Promise<DbDialect | null> {
  const inspection = inspectDbDialect(ctx)
  if (inspection.state === 'blocked') {
    ctx.logger.error(inspection.reason ?? 'database dialect selection is invalid')
    return null
  }
  if (inspection.dialect) {
    if (!ctx.state.get().answers.dbDialect) {
      ctx.state.patchAnswers({ dbDialect: inspection.dialect })
    }
    return inspection.dialect
  }

  const dialect = await ctx.prompter.select<DbDialect>({
    message: 'Which database should Byline use?',
    options: DB_DIALECTS.map((id, index) => ({
      value: id,
      label: `${DATABASE_ADAPTERS[id].label}${index === 0 ? ' (default)' : ''}`,
    })),
  })
  ctx.state.patchAnswers({ dbDialect: dialect })
  return dialect
}
