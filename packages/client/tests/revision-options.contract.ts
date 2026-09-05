import type { CollectionHandle, SingletonHandle } from '../src/index.js'

// Compiled by the standard client typecheck; never executed. Removing a required
// observation makes its @ts-expect-error unused and fails the gate.
function requiredObservations(collection: CollectionHandle, singleton: SingletonHandle) {
  // @ts-expect-error update requires an observation
  collection.update('doc', {})
  // @ts-expect-error metadata writes use the same required observation
  collection.update('doc', {}, { path: 'changed' })
  // @ts-expect-error status requires an observation
  collection.changeStatus('doc', 'published')
  // @ts-expect-error unpublish requires an observation
  collection.unpublish('doc')
  // @ts-expect-error delete requires an observation
  collection.delete('doc')
  // @ts-expect-error restore requires an observation of the current document
  collection.restoreVersion('doc', 'historical-version')
  // @ts-expect-error scheduling requires an observation
  collection.schedulePublish('doc', {
    expectedVersionId: 'version',
    publishAt: '2030-01-01T00:00:00Z',
  })
  // @ts-expect-error reconfirm requires an observation
  collection.confirmScheduledPublish('doc', { expectedVersionId: 'version' })
  // @ts-expect-error cancel requires an observation
  collection.cancelScheduledPublish('doc')
  // @ts-expect-error tree placement requires an observation
  collection.placeTreeNode('doc', { parentDocumentId: null })
  // @ts-expect-error tree removal requires an observation
  collection.removeFromTree('doc')
  // @ts-expect-error singleton save needs an explicit slot state or revision
  singleton.update({})
  // @ts-expect-error existing singleton save requires a revision
  singleton.update({}, { expectedState: 'document' })
  // @ts-expect-error status requires an observation
  singleton.changeStatus('published')
  // @ts-expect-error unpublish requires an observation
  singleton.unpublish()
  // @ts-expect-error schedule requires an observation
  singleton.schedulePublish({ expectedVersionId: 'version', publishAt: '2030-01-01T00:00:00Z' })
  // @ts-expect-error reconfirm requires an observation
  singleton.confirmScheduledPublish({ expectedVersionId: 'version' })
  // @ts-expect-error cancellation requires an observation
  singleton.cancelScheduledPublish()
  // @ts-expect-error restore requires an observation
  singleton.restoreVersion('historical-version')
  // @ts-expect-error locale copy requires an observation
  singleton.copyToLocale({ sourceLocale: 'en', targetLocale: 'fr' })

  collection.update('doc', {}, { expectedRevision: 2, path: 'changed' })
  singleton.update({}, { expectedState: 'empty' })
  singleton.update({}, { expectedRevision: 2 })
}
void requiredObservations
