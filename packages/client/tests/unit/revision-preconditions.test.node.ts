import { createSuperAdminContext } from '@byline/auth'
import {
  defineCollection,
  defineSingleton,
  getDocumentRevisionValidationDetails,
} from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'
import { testAdapter } from '../fixtures/test-adapter.js'

const definition = defineCollection({
  path: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  tree: true,
  fields: [],
})
const singleton = defineSingleton({ path: 'settings', label: 'Settings', fields: [] })

function handles() {
  const writes = vi.fn((): never => {
    throw new Error('Unexpected transaction')
  })
  const db = testAdapter({
    withTransaction: writes,
    queries: {
      collections: { getCollectionByPath: async () => ({ id: 'collection', version: 1 }) },
      singletons: { getMappedDocumentId: async () => 'document' },
    },
  })
  const client = createBylineClient({
    db,
    collections: [definition, singleton],
    requestContext: createSuperAdminContext({ id: 'editor' }),
  })
  return { collection: client.collection('pages'), singleton: client.singleton('settings'), writes }
}

const collectionCalls = [
  ['update', ['document', {}]],
  ['changeStatus', ['document', 'published']],
  ['unpublish', ['document']],
  ['delete', ['document']],
  ['restoreVersion', ['document', 'version']],
  [
    'schedulePublish',
    ['document', { expectedVersionId: 'version', publishAt: '2030-01-01T00:00:00Z' }],
  ],
  ['confirmScheduledPublish', ['document', { expectedVersionId: 'version' }]],
  ['cancelScheduledPublish', ['document']],
  ['placeTreeNode', ['document', { parentDocumentId: null }]],
  ['removeFromTree', ['document']],
] as const
const singletonCalls = [
  ['update', [{}]],
  ['changeStatus', ['published']],
  ['unpublish', []],
  ['restoreVersion', ['version']],
  ['schedulePublish', [{ expectedVersionId: 'version', publishAt: '2030-01-01T00:00:00Z' }]],
  ['confirmScheduledPublish', [{ expectedVersionId: 'version' }]],
  ['cancelScheduledPublish', []],
  ['copyToLocale', [{ sourceLocale: 'en', targetLocale: 'fr' }]],
] as const

describe('untyped SDK callers must supply an observation', () => {
  for (const [kind, calls] of [
    ['collection', collectionCalls],
    ['singleton', singletonCalls],
  ] as const) {
    for (const [method, args] of calls) {
      it(`${kind}.${method} rejects omission before a write`, async () => {
        const fixture = handles()
        const handle = fixture[kind]
        const error = await Reflect.apply(Reflect.get(handle, method), handle, args).catch(
          (error: unknown) => error
        )
        expect(getDocumentRevisionValidationDetails(error)).toEqual({
          reason: 'missing_document_revision',
        })
        expect(fixture.writes).not.toHaveBeenCalled()
      })
    }
  }
})
