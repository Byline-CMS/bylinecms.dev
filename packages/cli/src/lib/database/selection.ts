import { DATABASE_ADAPTER_IDS, DATABASE_ADAPTERS, DEFAULT_DATABASE_ADAPTER } from './adapters.js'
import type { Context } from '../../context.js'
import type { DatabaseAdapterId } from '../../types.js'

export interface DatabaseAdapterInspection {
  state: 'resolved' | 'pending' | 'blocked'
  adapter?: DatabaseAdapterId
  reason?: string
}

export function isDatabaseAdapterId(value: unknown): value is DatabaseAdapterId {
  return typeof value === 'string' && (DATABASE_ADAPTER_IDS as readonly string[]).includes(value)
}

export function inspectDatabaseAdapter(ctx: Context): DatabaseAdapterInspection {
  const persisted = ctx.state.get().answers.dbAdapter
  const requested = ctx.cliFlags.database

  if (requested !== undefined && !isDatabaseAdapterId(requested)) {
    return {
      state: 'blocked',
      reason: `invalid database adapter "${String(requested)}"; expected ${DATABASE_ADAPTER_IDS.join(' or ')}`,
    }
  }
  if (persisted !== undefined && !isDatabaseAdapterId(persisted)) {
    return {
      state: 'blocked',
      reason: `persisted database adapter "${String(persisted)}" is invalid`,
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
  const adapter = persisted ?? requested
  return adapter ? { state: 'resolved', adapter } : { state: 'pending' }
}

export async function resolveDatabaseAdapter(ctx: Context): Promise<DatabaseAdapterId | null> {
  const inspection = inspectDatabaseAdapter(ctx)
  if (inspection.state === 'blocked') {
    ctx.logger.error(inspection.reason ?? 'database adapter selection is invalid')
    return null
  }
  if (inspection.adapter) {
    if (!ctx.state.get().answers.dbAdapter) {
      ctx.state.patchAnswers({ dbAdapter: inspection.adapter })
    }
    return inspection.adapter
  }

  const adapter = await ctx.prompter.select<DatabaseAdapterId>({
    message: 'Which database should Byline use?',
    options: DATABASE_ADAPTER_IDS.map((id) => ({
      value: id,
      label: `${DATABASE_ADAPTERS[id].selectionLabel}${id === DEFAULT_DATABASE_ADAPTER ? ' (default)' : ''}`,
    })),
  })
  ctx.state.patchAnswers({ dbAdapter: adapter })
  return adapter
}
