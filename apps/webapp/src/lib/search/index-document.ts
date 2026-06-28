/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Host-side search-index maintenance — the glue between the collection
 * lifecycle hooks and the registered `SearchProvider` (see
 * docs/05-reading-and-delivery/07-search.md). A collection's `hooks.ts`
 * calls `syncDocumentToSearchIndex` on create / update / status-change /
 * unpublish and `removeDocumentFromSearchIndex` on delete — mirroring how the
 * same hooks drive L1 cache invalidation.
 *
 * Server-only: this module reads documents through the admin client and talks
 * to the provider. It is reached from `docs/hooks.ts`, which the schema loads
 * via `() => import('./hooks.js')`, so it never enters the client bundle.
 *
 * Indexing is **published-only** and **re-sync by read**: for each content
 * locale we read the document's *published* view (`status: 'published'`,
 * `onMissingLocale: 'omit'`). Present → `upsert`; absent → `remove` that
 * locale. This one path handles publish, unpublish, draft-over-published, and
 * plain edits uniformly and idempotently — the index always mirrors what a
 * public reader can see.
 */

import {
  buildSearchDocument,
  type CollectionDefinition,
  getCollectionDefinition,
  getServerConfig,
  type PopulateMap,
  resolveIdentityField,
} from '@byline/core'
import { getAdminBylineClient } from '@byline/host-tanstack-start/integrations/byline-client'

interface DocumentRef {
  collectionPath: string
  documentId: string
}

/**
 * Re-sync one document into the search index across every content locale.
 * No-op when no provider is registered or the collection doesn't opt into
 * search. Safe to call from any `afterX` hook (they run post-commit).
 */
export async function syncDocumentToSearchIndex({
  collectionPath,
  documentId,
}: DocumentRef): Promise<void> {
  const provider = getServerConfig().search
  if (provider == null) return

  const definition = getCollectionDefinition(collectionPath)
  if (definition?.search == null) return

  const client = getAdminBylineClient()
  const toText = getServerConfig().fields?.richText?.toText
  const populate = buildFacetPopulateMap(definition)
  const locales = getServerConfig().i18n.content.locales

  for (const locale of locales) {
    // `omit` returns null when the document has no published content in this
    // locale (rather than falling back to the default) — exactly the signal
    // for "this locale should not be in the index".
    const doc = await client.collection(collectionPath).findById(documentId, {
      locale,
      status: 'published',
      onMissingLocale: 'omit',
      populate,
      _bypassBeforeRead: true,
    })

    if (doc == null) {
      await provider.remove({ collectionPath, documentId, locale })
      continue
    }

    const searchDoc = buildSearchDocument(
      {
        documentId: doc.id,
        locale,
        status: doc.status,
        path: doc.path,
        fields: doc.fields as Record<string, unknown>,
        updatedAt: doc.updatedAt,
      },
      definition,
      {
        locale,
        richTextToText: toText,
        resolveTargetDefinition: (path) => getCollectionDefinition(path) ?? null,
      }
    )

    await provider.upsert(searchDoc)
  }
}

/**
 * Remove one document from the search index entirely (all locales). Called
 * from `afterDelete`.
 */
export async function removeDocumentFromSearchIndex({
  collectionPath,
  documentId,
}: DocumentRef): Promise<void> {
  const provider = getServerConfig().search
  if (provider == null) return
  await provider.remove({ collectionPath, documentId })
}

/**
 * Build the populate map for a collection's facet relation fields so each
 * target arrives with the two fields the assembler needs: its `counter` field
 * (the aggregation id) and its identity field (`useAsTitle`, the term).
 * Returns `undefined` when the collection declares no facets.
 */
function buildFacetPopulateMap(definition: CollectionDefinition): PopulateMap | undefined {
  const facets = definition.search?.facets
  if (facets == null || facets.length === 0) return undefined

  const map: PopulateMap = {}
  for (const decl of facets) {
    const name = typeof decl === 'string' ? decl : decl.field
    const field = definition.fields.find((f) => f.name === name)
    if (field == null || field.type !== 'relation') continue

    const targetPath = (field as { targetCollection?: string }).targetCollection
    const targetDef = targetPath ? getCollectionDefinition(targetPath) : undefined
    const select: string[] = []
    const idField = targetDef?.fields.find((f) => f.type === 'counter')?.name
    const termField = targetDef ? resolveIdentityField(targetDef) : undefined
    if (idField) select.push(idField)
    if (termField) select.push(termField)

    map[name] = select.length > 0 ? { select } : true
  }

  return Object.keys(map).length > 0 ? map : undefined
}
