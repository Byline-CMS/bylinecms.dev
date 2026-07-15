import { describe, expect, it, vi } from 'vitest'

import {
  createAdminTreeMoveController,
  executeAdminTreeMove,
  getAdminTreeMoveUiEffects,
  isCommittedTreeHookFailure,
  isTreeMutationConflict,
  placeAdminTreeNode,
  removeAdminTreeNode,
  shouldSyncAdminTreeRows,
} from './tree-mutation.js'

describe('admin tree mutations', () => {
  it('recognises a coded stale-tree conflict', () => {
    expect(isTreeMutationConflict({ code: 'ERR_CONFLICT' })).toBe(true)
    expect(isTreeMutationConflict(new Error('tree placement is stale: neighbours moved'))).toBe(
      true
    )
    expect(isTreeMutationConflict(new Error('failed'))).toBe(false)
  })

  it('recognises a coded committed tree-hook rejection', () => {
    expect(isCommittedTreeHookFailure({ code: 'ERR_TREE_HOOK_COMMITTED' })).toBe(true)
    expect(isCommittedTreeHookFailure({ code: 'ERR_CONFLICT' })).toBe(false)
  })

  it('refreshes canonical tree data after a rejected mutation', async () => {
    const mutationError = new Error('tree placement is stale: neighbours moved')
    const refresh = vi.fn().mockResolvedValue(undefined)

    await expect(
      executeAdminTreeMove(vi.fn().mockRejectedValue(mutationError), refresh)
    ).resolves.toEqual({ status: 'mutation-failed', error: mutationError })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('reports a refresh failure separately after a successful mutation', async () => {
    const refreshError = new Error('router unavailable')

    await expect(
      executeAdminTreeMove(
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockRejectedValue(refreshError)
      )
    ).resolves.toEqual({ status: 'refresh-failed', error: refreshError })
  })

  it('keeps a committed hook rejection separate from mutation failure', async () => {
    const hookError = { code: 'ERR_TREE_HOOK_COMMITTED', message: 'hook failed' }
    const refresh = vi.fn().mockResolvedValue(undefined)

    const outcome = await executeAdminTreeMove(vi.fn().mockRejectedValue(hookError), refresh)

    expect(outcome).toEqual({ status: 'committed-hook-failed', error: hookError })
    expect(getAdminTreeMoveUiEffects(outcome)).toEqual({
      rollback: false,
      preserveOptimistic: false,
      structuralFailure: null,
      committedHookWarning: true,
      refreshWarning: false,
    })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('preserves optimistic UI when committed-hook refresh also fails', async () => {
    const hookError = { code: 'ERR_TREE_HOOK_COMMITTED', message: 'hook failed' }
    const refreshError = new Error('refresh failed')
    const outcome = await executeAdminTreeMove(
      vi.fn().mockRejectedValue(hookError),
      vi.fn().mockRejectedValue(refreshError)
    )

    expect(outcome).toEqual({
      status: 'committed-hook-failed',
      error: hookError,
      refreshError,
    })
    expect(getAdminTreeMoveUiEffects(outcome)).toEqual({
      rollback: false,
      preserveOptimistic: true,
      structuralFailure: null,
      committedHookWarning: true,
      refreshWarning: true,
    })
  })

  it('keeps ordinary mutation failure rollback policy', () => {
    expect(
      getAdminTreeMoveUiEffects({
        status: 'mutation-failed',
        error: { code: 'ERR_CONFLICT' },
      })
    ).toEqual({
      rollback: true,
      preserveOptimistic: false,
      structuralFailure: 'conflict',
      committedHookWarning: false,
      refreshWarning: false,
    })
  })

  it('preserves optimistic rows after refresh failure until canonical rows change', () => {
    const staleRows = [{ id: 'old' }]
    expect(shouldSyncAdminTreeRows(staleRows, staleRows, false)).toBe(false)
    expect(shouldSyncAdminTreeRows([{ id: 'canonical' }], staleRows, false)).toBe(true)
    expect(shouldSyncAdminTreeRows([{ id: 'canonical' }], null, true)).toBe(false)
  })

  it('suppresses a second move while the first move is in flight', async () => {
    const controller = createAdminTreeMoveController()
    let resolveMutation: (() => void) | undefined
    const mutate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
    )
    const refresh = vi.fn().mockResolvedValue(undefined)

    const first = controller.execute(mutate, refresh)
    expect(controller.isMoving()).toBe(true)
    await expect(controller.execute(mutate, refresh)).resolves.toEqual({ status: 'suppressed' })
    expect(mutate).toHaveBeenCalledOnce()

    resolveMutation?.()
    await expect(first).resolves.toEqual({ status: 'ok' })
    expect(refresh).toHaveBeenCalledOnce()
    expect(controller.isMoving()).toBe(false)
  })

  it('refreshes and unlocks after a rejected mutation', async () => {
    const controller = createAdminTreeMoveController()
    const mutationError = new Error('rejected')
    const refresh = vi.fn().mockResolvedValue(undefined)

    await expect(
      controller.execute(vi.fn().mockRejectedValue(mutationError), refresh)
    ).resolves.toEqual({ status: 'mutation-failed', error: mutationError })
    expect(refresh).toHaveBeenCalledOnce()
    expect(controller.isMoving()).toBe(false)
  })

  it('unlocks and reports only refresh failure after a successful commit', async () => {
    const controller = createAdminTreeMoveController()
    const refreshError = new Error('refresh failed')

    const outcome = await controller.execute(
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(refreshError)
    )

    expect(outcome).toEqual({ status: 'refresh-failed', error: refreshError })
    expect(outcome.status).not.toBe('mutation-failed')
    expect(controller.isMoving()).toBe(false)
  })

  it('opts ordinary placement retries into lifecycle reconciliation', async () => {
    const placeTreeNode = vi
      .fn()
      .mockRejectedValueOnce(new Error('post-commit hook failed'))
      .mockResolvedValue({ orderKey: 'key-1' })

    const retry = () =>
      placeAdminTreeNode({ placeTreeNode } as any, 'doc-1', {
        parentDocumentId: 'parent-1',
        beforeDocumentId: 'left-1',
      })

    await expect(retry()).rejects.toThrow('post-commit hook failed')
    await expect(retry()).resolves.toEqual({ orderKey: 'key-1' })

    expect(placeTreeNode).toHaveBeenCalledTimes(2)
    expect(placeTreeNode).toHaveBeenNthCalledWith(
      2,
      'doc-1',
      expect.objectContaining({ reconcile: true })
    )
  })

  it('opts ordinary removal retries into lifecycle reconciliation', async () => {
    const removeFromTree = vi.fn().mockResolvedValue(undefined)

    await removeAdminTreeNode({ removeFromTree } as any, 'doc-1')

    expect(removeFromTree).toHaveBeenCalledWith('doc-1', { reconcile: true })
  })

  it('preserves an explicit reconciliation override', async () => {
    const placeTreeNode = vi.fn().mockResolvedValue({ orderKey: 'key-1' })
    const removeFromTree = vi.fn().mockResolvedValue(undefined)

    await placeAdminTreeNode({ placeTreeNode } as any, 'doc-1', {
      parentDocumentId: null,
      reconcile: false,
    })
    await removeAdminTreeNode({ removeFromTree } as any, 'doc-1', { reconcile: false })

    expect(placeTreeNode).toHaveBeenCalledWith('doc-1', {
      parentDocumentId: null,
      reconcile: false,
    })
    expect(removeFromTree).toHaveBeenCalledWith('doc-1', { reconcile: false })
  })
})
