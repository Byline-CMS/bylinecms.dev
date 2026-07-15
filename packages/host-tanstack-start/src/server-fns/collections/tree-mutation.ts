import type { CollectionHandle, PlaceTreeNodeOptions, RemoveFromTreeOptions } from '@byline/client'

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

/** Works with both BylineError and the coded error reconstructed by TanStack Start. */
export function isTreeMutationConflict(error: unknown): boolean {
  return (
    hasErrorCode(error, 'ERR_CONFLICT') ||
    (error instanceof Error && error.message.startsWith('tree placement is stale:'))
  )
}

/** The tree/audit transaction committed even though its post-commit hook rejected. */
export function isCommittedTreeHookFailure(error: unknown): boolean {
  return hasErrorCode(error, 'ERR_TREE_HOOK_COMMITTED')
}

export type AdminTreeMoveOutcome =
  | { status: 'ok' }
  | { status: 'suppressed' }
  | { status: 'mutation-failed'; error: unknown; refreshError?: unknown }
  | { status: 'committed-hook-failed'; error: unknown; refreshError?: unknown }
  | { status: 'refresh-failed'; error: unknown }

export interface AdminTreeMoveUiEffects {
  rollback: boolean
  preserveOptimistic: boolean
  structuralFailure: 'conflict' | 'generic' | null
  committedHookWarning: boolean
  refreshWarning: boolean
}

/** Pure UI policy for every mutation/refresh outcome. */
export function getAdminTreeMoveUiEffects(outcome: AdminTreeMoveOutcome): AdminTreeMoveUiEffects {
  if (outcome.status === 'mutation-failed') {
    return {
      rollback: true,
      preserveOptimistic: false,
      structuralFailure: isTreeMutationConflict(outcome.error) ? 'conflict' : 'generic',
      committedHookWarning: false,
      refreshWarning: outcome.refreshError != null,
    }
  }
  if (outcome.status === 'committed-hook-failed') {
    return {
      rollback: false,
      preserveOptimistic: outcome.refreshError != null,
      structuralFailure: null,
      committedHookWarning: true,
      refreshWarning: outcome.refreshError != null,
    }
  }
  if (outcome.status === 'refresh-failed') {
    return {
      rollback: false,
      preserveOptimistic: true,
      structuralFailure: null,
      committedHookWarning: false,
      refreshWarning: true,
    }
  }
  return {
    rollback: outcome.status === 'suppressed',
    preserveOptimistic: false,
    structuralFailure: null,
    committedHookWarning: false,
    refreshWarning: false,
  }
}

/** Preserve a committed optimistic move until a later loader returns new row data. */
export function shouldSyncAdminTreeRows(
  rows: unknown,
  preservedRows: unknown,
  isMoving: boolean
): boolean {
  return !isMoving && rows !== preservedRows
}

/** Keep mutation and canonical-refresh failures distinct for optimistic tree UIs. */
export async function executeAdminTreeMove(
  mutate: () => Promise<unknown>,
  refresh: () => Promise<unknown>
): Promise<AdminTreeMoveOutcome> {
  try {
    await mutate()
  } catch (error) {
    const status = isCommittedTreeHookFailure(error)
      ? ('committed-hook-failed' as const)
      : ('mutation-failed' as const)
    try {
      await refresh()
      return { status, error }
    } catch (refreshError) {
      return { status, error, refreshError }
    }
  }

  try {
    await refresh()
    return { status: 'ok' }
  } catch (error) {
    return { status: 'refresh-failed', error }
  }
}

export interface AdminTreeMoveController {
  isMoving(): boolean
  execute(
    mutate: () => Promise<unknown>,
    refresh: () => Promise<unknown>
  ): Promise<AdminTreeMoveOutcome>
}

/** Single-flight controller shared by pointer and keyboard tree moves. */
export function createAdminTreeMoveController(): AdminTreeMoveController {
  let moving = false
  return {
    isMoving: () => moving,
    execute: async (mutate, refresh) => {
      if (moving) return { status: 'suppressed' }
      moving = true
      try {
        return await executeAdminTreeMove(mutate, refresh)
      } finally {
        moving = false
      }
    },
  }
}

/** Admin retries reconcile post-commit tree hooks unless explicitly disabled. */
export function placeAdminTreeNode(
  handle: Pick<CollectionHandle, 'placeTreeNode'>,
  documentId: string,
  options: PlaceTreeNodeOptions
): Promise<{ orderKey: string }> {
  return handle.placeTreeNode(documentId, {
    ...options,
    reconcile: options.reconcile ?? true,
  })
}

/** Admin retries reconcile post-commit tree hooks unless explicitly disabled. */
export function removeAdminTreeNode(
  handle: Pick<CollectionHandle, 'removeFromTree'>,
  documentId: string,
  options: RemoveFromTreeOptions = {}
): Promise<void> {
  return handle.removeFromTree(documentId, {
    ...options,
    reconcile: options.reconcile ?? true,
  })
}
