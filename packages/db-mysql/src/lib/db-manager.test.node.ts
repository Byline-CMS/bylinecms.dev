import { describe, expect, it } from 'vitest'

import { type DBExecutor, DBManagerImpl, TXManagerImpl } from './db-manager.js'

describe('adapter transaction ownership', () => {
  it('does not leak one adapter transaction into another adapter pool', async () => {
    const poolA = {} as DBExecutor
    const poolB = {} as DBExecutor
    const tx = {} as DBExecutor
    const a = new DBManagerImpl({ dbPool: poolA })
    const b = new DBManagerImpl({ dbPool: poolB })
    await a.runInTransaction(tx, async () => {
      expect(a.get()).toBe(tx)
      expect(a.isInTransaction()).toBe(true)
      expect(b.get()).toBe(poolB)
      expect(b.isInTransaction()).toBe(false)
      expect(b.getTransactionScope()).toBeUndefined()
    })
    expect(a.get()).toBe(poolA)
    expect(a.getTransactionScope()).toBeUndefined()
  })
  it('preserves root scope through savepoints and restores the parent executor', async () => {
    const pool = {} as DBExecutor
    const outer = {} as DBExecutor
    const inner = {} as DBExecutor
    const manager = new DBManagerImpl({ dbPool: pool })
    await manager.runInTransaction(outer, async () => {
      const scope = manager.getTransactionScope()
      await expect(
        manager.runInTransaction(inner, async () => {
          expect(manager.get()).toBe(inner)
          expect(manager.getTransactionScope()).toBe(scope)
          throw new Error('rollback')
        })
      ).rejects.toThrow('rollback')
      expect(manager.get()).toBe(outer)
      expect(manager.getTransactionScope()).toBe(scope)
    })
  })
})

describe('owned transaction lock failures', () => {
  const conflict = () => Object.assign(new Error('driver SQL detail'), { errno: 1213 })
  for (const outcome of ['rollback', 'rollback failure', 'commit failure', 'nested'] as const) {
    it(`only marks confirmed whole rollback retryable: ${outcome}`, async () => {
      const original = conflict()
      const replacement = new Error('connection lost')
      let rollbackCompleted = false
      const executor = {
        transaction: async <T>(fn: (tx: DBExecutor) => Promise<T>) => {
          let result: T
          try {
            result = await fn(executor as DBExecutor)
          } catch (error) {
            if (outcome === 'rollback failure') throw replacement
            rollbackCompleted = true
            throw error
          }
          if (outcome === 'commit failure') throw original
          return result
        },
      }
      const db = new DBManagerImpl({ dbPool: executor as DBExecutor })
      const manager = new TXManagerImpl({ db })
      const operation = () =>
        manager.withTransaction(async () => {
          if (outcome !== 'commit failure') throw original
          return 'ok'
        })
      const pending =
        outcome === 'nested' ? db.runInTransaction(executor as DBExecutor, operation) : operation()
      if (outcome === 'rollback') {
        await expect(pending).rejects.toMatchObject({
          code: 'ERR_LOCK_CONFLICT',
          details: { reason: 'lock_conflict', rolledBack: true, retryable: true },
          cause: original,
        })
        expect(rollbackCompleted).toBe(true)
      } else {
        await expect(pending).rejects.toBe(outcome === 'rollback failure' ? replacement : original)
      }
    })
  }
})
