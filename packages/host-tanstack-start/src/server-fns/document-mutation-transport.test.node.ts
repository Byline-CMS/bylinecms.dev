import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import {
  ERR_CONFLICT,
  ERR_DOCUMENT_HOOK_COMMITTED,
  ERR_DOCUMENT_STALE,
  ERR_LOCK_CONFLICT,
  ERR_NOT_FOUND,
  ERR_TREE_HOOK_COMMITTED,
  ERR_VALIDATION,
  getDocumentRevisionValidationDetails,
  getDocumentStaleDetails,
  getLockConflictDetails,
} from '@byline/core'
import { getDocumentHookCommittedDetails } from '@byline/core/services'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { documentMutationError, withDocumentMutationErrors } from './document-mutation-errors.js'

// Exercise the installed Start HTTP handler and its real Seroval protocol. Only
// manifest lookup and request-local response state are supplied by this harness;
// the production application's compiled actions are covered by browser tests.
const require = createRequire(import.meta.url)
const startRequire = createRequire(require.resolve('@tanstack/react-start/package.json'))
const serverPackage = startRequire.resolve('@tanstack/start-server-core/package.json')
const esm = join(dirname(serverPackage), 'src')
const serverRequire = createRequire(serverPackage)
let handler: (input: { request: Request; context: object; serverFnId: string }) => Promise<Response>
let seroval: {
  toJSONAsync(value: unknown): Promise<unknown>
  fromCrossJSON(value: unknown, options: object): unknown
}
let runWithStartContext: (context: object, fn: () => Promise<Response>) => Promise<Response>
let action: (input: { data: unknown }) => Promise<unknown>

beforeAll(async () => {
  vi.doMock(join(esm, 'getServerFnById.ts'), () => ({ getServerFnById: async () => action }))
  vi.doMock(join(esm, 'request-response.ts'), () => ({
    getResponse: () => ({ status: 200, headers: new Headers() }),
  }))
  handler = (await import(join(esm, 'server-functions-handler.ts'))).handleServerAction
  seroval = await import(serverRequire.resolve('seroval'))
  runWithStartContext = (
    await import(
      join(
        dirname(serverRequire.resolve('@tanstack/start-storage-context/package.json')),
        'dist/esm/index.js'
      )
    )
  ).runWithStartContext
})

async function roundTrip(data: unknown, operation: (data: unknown) => Promise<unknown>) {
  const guarded = withDocumentMutationErrors(operation)
  action = async ({ data }) => {
    try {
      return { result: await guarded(data) }
    } catch (error) {
      return { error }
    }
  }
  const request = new Request('http://localhost/_serverFn/document-mutation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tsr-serverFn': 'true' },
    body: JSON.stringify(await seroval.toJSONAsync({ data })),
  })
  const response = await runWithStartContext(
    {
      request,
      startOptions: {},
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
      handlerType: 'serverFn',
      getRouter: () => {
        throw new Error('Router not used')
      },
    },
    () => handler({ request, context: {}, serverFnId: 'document-mutation' })
  )
  const wire = await response.text()
  const decoded = seroval.fromCrossJSON(JSON.parse(wire), {})
  if (typeof decoded !== 'object' || decoded === null) throw new Error('Expected wire envelope')
  return {
    value: { error: Reflect.get(decoded, 'error'), result: Reflect.get(decoded, 'result') },
    wire,
  }
}

const staleCases = [
  { reason: 'revision_mismatch', documentId: 'doc', expectedRevision: 1, currentRevision: 2 },
  {
    reason: 'version_parent_mismatch',
    documentId: 'doc',
    previousVersionId: 'old',
    currentVersionId: 'new',
  },
  {
    reason: 'singleton_slot_changed',
    singletonPath: 'settings',
    expectedState: 'empty',
    currentState: 'document',
  },
] as const

describe('document failures over Start HTTP serialization', () => {
  for (const details of staleCases) {
    it(`retains ${details.reason} and excludes diagnostics`, async () => {
      const { value, wire } = await roundTrip({}, async () => {
        throw ERR_DOCUMENT_STALE({
          message: 'private driver detail',
          details,
          cause: new Error('SELECT secret'),
          logExtra: { private: true },
        })
      })
      expect(getDocumentStaleDetails(value.error)).toEqual(details)
      expect(wire).not.toMatch(/private driver|SELECT secret|logExtra/)
    })
  }
  for (const reason of ['missing_document_revision', 'invalid_document_revision'] as const) {
    it(`retains reload-required validation: ${reason}`, async () => {
      const { value } = await roundTrip({}, async () => {
        throw ERR_VALIDATION({ message: 'internal', details: { reason } })
      })
      expect(getDocumentRevisionValidationDetails(value.error)).toEqual({ reason })
      expect(getDocumentStaleDetails(value.error)).toBeNull()
    })
  }
  it('retains a confirmed rollback without relabelling it stale', async () => {
    const details = { reason: 'lock_conflict', rolledBack: true, retryable: true }
    const { value, wire } = await roundTrip({}, async () => {
      throw ERR_LOCK_CONFLICT({
        message: 'driver message',
        details,
        cause: new Error('SQL private'),
      })
    })
    expect(getLockConflictDetails(value.error)).toEqual(details)
    expect(getDocumentStaleDetails(value.error)).toBeNull()
    expect(wire).not.toMatch(/driver message|SQL private/)
  })
  it('keeps committed hook warnings separate and preserves their committed revision', async () => {
    const details = {
      phase: 'afterUpdate',
      documentId: 'doc',
      documentVersionId: 'version',
      revision: 3,
      sideEffectCode: 'ERR_UNHANDLED',
    }
    const { value, wire } = await roundTrip({}, async () => {
      throw ERR_DOCUMENT_HOOK_COMMITTED({
        message: 'private hook failure',
        details,
        cause: new Error('secret hook'),
      })
    })
    expect(getDocumentHookCommittedDetails(value.error)).toEqual(details)
    expect(getDocumentStaleDetails(value.error)).toBeNull()
    expect(getLockConflictDetails(value.error)).toBeNull()
    expect(wire).not.toMatch(/private hook failure|secret hook/)
  })
  it('round-trips safe integer observations and receipts as numbers', async () => {
    const { value } = await roundTrip(
      { expectedRevision: Number.MAX_SAFE_INTEGER - 1 },
      async (data) => {
        expect(data).toEqual({ expectedRevision: Number.MAX_SAFE_INTEGER - 1 })
        return { documentId: 'doc', revision: Number.MAX_SAFE_INTEGER }
      }
    )
    expect(value.result).toEqual({ documentId: 'doc', revision: Number.MAX_SAFE_INTEGER })
  })
  it('does not classify unrelated or malformed conflicts by message', () => {
    const conflict = ERR_CONFLICT({ message: 'This document has changed.' })
    expect(documentMutationError(conflict)).toBe(conflict)
    const malformed = { code: 'ERR_DOCUMENT_STALE', details: { reason: 'revision_mismatch' } }
    expect(documentMutationError(malformed)).toBe(malformed)
  })
})

it('transports the authorized structural receipt on committed tree hook failure without diagnostics', async () => {
  const receipt = {
    documentId: 'doc',
    revision: 3,
    affectedDocuments: [{ documentId: 'allowed-sibling', revision: 4 }],
    scheduledPublicationsNeedReconfirmation: true,
  }
  const { value, wire } = await roundTrip({}, async () => {
    throw ERR_TREE_HOOK_COMMITTED({
      message: 'private hook diagnostics',
      cause: new Error('SQL secret'),
      details: { ...receipt, change: 'reorder', affectedDocumentIds: ['private'], internal: true },
    })
  })
  expect(value.error).toEqual({
    code: 'ERR_TREE_HOOK_COMMITTED',
    message: 'The structure was saved, but a follow-up action failed.',
    details: receipt,
  })
  expect(wire).not.toMatch(/private|SQL secret|internal/)
})
it('transports unavailable-document errors without provider details', async () => {
  const { value, wire } = await roundTrip({}, async () => {
    throw ERR_NOT_FOUND({ message: 'private unavailable reason', details: { internal: true } })
  })
  expect(value.error).toEqual({
    code: 'ERR_NOT_FOUND',
    message: 'This document is no longer available.',
  })
  expect(wire).not.toMatch(/private|internal/)
})
