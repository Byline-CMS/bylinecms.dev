/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { commitDocumentStatusTransition } from './status-transition.js'
import type { AuditLogAppendInput, IDbAdapter } from '../../@types/index.js'

function createTransitionHarness() {
  const order: string[] = []
  const auditRows: AuditLogAppendInput[] = []
  let status = 'draft'
  let archived = false

  const db = {
    commands: {
      documents: {
        setDocumentStatus: async ({ status: nextStatus }: { status: string }) => {
          order.push('status-write')
          status = nextStatus
        },
        archivePublishedVersions: async () => {
          order.push('auto-archive')
          archived = true
          return 1
        },
      },
      audit: {
        append: async (input: AuditLogAppendInput) => {
          order.push('audit-append')
          auditRows.push(input)
          return { id: 'audit-1' }
        },
      },
    },
    withTransaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      const snapshot = {
        status,
        archived,
        auditLength: auditRows.length,
      }
      order.push('transaction-start')
      try {
        const result = await fn()
        order.push('transaction-commit')
        return result
      } catch (error) {
        status = snapshot.status
        archived = snapshot.archived
        auditRows.length = snapshot.auditLength
        order.push('transaction-rollback')
        throw error
      }
    },
  } as unknown as IDbAdapter

  return {
    db,
    order,
    auditRows,
    get status() {
      return status
    },
    get archived() {
      return archived
    },
  }
}

function transitionParams(db: IDbAdapter) {
  return {
    db,
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    collectionId: 'col-1',
    previousStatus: 'draft',
    nextStatus: 'published',
    actor: {
      actorId: '01901234-0000-7000-8000-000000000001',
      actorRealm: 'admin' as const,
    },
  }
}

describe('commitDocumentStatusTransition', () => {
  it('runs contributions inside the transaction at the specified boundaries', async () => {
    const harness = createTransitionHarness()

    await commitDocumentStatusTransition({
      ...transitionParams(harness.db),
      contributions: {
        beforeStatusWrite: () => {
          harness.order.push('before-contribution')
        },
        afterAuditAppend: () => {
          harness.order.push('after-contribution')
        },
      },
    })

    expect(harness.order).toEqual([
      'transaction-start',
      'before-contribution',
      'status-write',
      'auto-archive',
      'audit-append',
      'after-contribution',
      'transaction-commit',
    ])
  })

  it('aborts before any mutation or audit when the before contribution throws', async () => {
    const harness = createTransitionHarness()
    const error = new Error('guard rejected')

    await expect(
      commitDocumentStatusTransition({
        ...transitionParams(harness.db),
        contributions: {
          beforeStatusWrite: () => {
            throw error
          },
        },
      })
    ).rejects.toBe(error)

    expect(harness.status).toBe('draft')
    expect(harness.archived).toBe(false)
    expect(harness.auditRows).toEqual([])
    expect(harness.order).toEqual(['transaction-start', 'transaction-rollback'])
  })

  it('rolls the status, auto-archive, and audit back when the after contribution throws', async () => {
    const harness = createTransitionHarness()
    const error = new Error('schedule deletion failed')

    await expect(
      commitDocumentStatusTransition({
        ...transitionParams(harness.db),
        contributions: {
          afterAuditAppend: () => {
            throw error
          },
        },
      })
    ).rejects.toBe(error)

    expect(harness.status).toBe('draft')
    expect(harness.archived).toBe(false)
    expect(harness.auditRows).toEqual([])
    expect(harness.order).toEqual([
      'transaction-start',
      'status-write',
      'auto-archive',
      'audit-append',
      'transaction-rollback',
    ])
  })
})
