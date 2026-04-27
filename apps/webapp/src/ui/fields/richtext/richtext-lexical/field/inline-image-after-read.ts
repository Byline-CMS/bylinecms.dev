/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Opt-in `afterRead` hook factory that re-hydrates `relation.document` on
 * inline-image nodes inside named rich-text fields. Use this when you want
 * read-time freshness on top of the write-time denormalisation the modal
 * already performs (the modal copies `{ title, altText, image }` into
 * `relation.document` on save).
 *
 * @example
 * ```ts
 * import { defineCollection } from '@byline/core'
 * import { inlineImageAfterRead } from '@/ui/fields/richtext/richtext-lexical/field/inline-image-after-read'
 *
 * export const Docs = defineCollection({
 *   path: 'docs',
 *   useAsTitle: 'title',
 *   hooks: {
 *     afterRead: inlineImageAfterRead({ richTextFields: ['body'] }),
 *   },
 *   fields: [
 *     { name: 'title', type: 'text' },
 *     { name: 'body', type: 'richText' },
 *   ],
 * })
 * ```
 */

import type { AfterReadContext, StoredFileValue } from '@byline/core'
import { getCollectionDefinition } from '@byline/core'

import { deriveImageSizes } from './plugins/inline-image-plugin/utils'

/**
 * Lexical-shaped node — the parts we care about. Carries an unknown
 * `children` array because nodes can nest (paragraphs, lists, tables …).
 */
interface LexicalNodeLike {
  type?: string
  children?: LexicalNodeLike[]
  // Inline-image-specific fields (only present when type === 'inline-image')
  relation?: {
    targetDocumentId?: string
    targetCollectionId?: string
    targetCollectionPath?: string
    document?: Record<string, any>
  }
}

interface LexicalRoot {
  root?: LexicalNodeLike
}

/**
 * Walk a Lexical tree and yield every `inline-image` node it contains.
 * Mutating `node.relation.document` during iteration is safe — the walk is
 * top-down and doesn't revisit nodes.
 */
function* iterInlineImageNodes(node: LexicalNodeLike): Generator<LexicalNodeLike, void, void> {
  if (node == null) return
  if (node.type === 'inline-image') {
    yield node
    // Inline-image nodes also contain a nested caption editor's children;
    // we still descend to catch any nested inline-image inside the caption.
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      yield* iterInlineImageNodes(child)
    }
  }
}

/**
 * Read a rich-text field value (Lexical JSON object or stringified) and
 * return its root node, or null if the value is not a parseable Lexical tree.
 */
function getLexicalRoot(value: unknown): LexicalNodeLike | null {
  if (value == null) return null
  let parsed: LexicalRoot | LexicalNodeLike | null = null
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as LexicalRoot
    } catch {
      return null
    }
  } else if (typeof value === 'object') {
    parsed = value as LexicalRoot | LexicalNodeLike
  }
  if (parsed == null) return null
  if ('root' in parsed && parsed.root != null) return parsed.root
  return parsed as LexicalNodeLike
}

interface InlineImageAfterReadOptions {
  /**
   * Field names on the consuming collection whose Lexical JSON should be
   * scanned for inline-image references. Each named field must be a
   * `richText` field on the collection.
   */
  richTextFields: string[]
  /**
   * Optional source-collection allowlist. Defaults to allowing every
   * collection path the picker can target; set this to e.g. `['media']`
   * to skip nodes that point at collections you don't want to hydrate.
   */
  sourceCollections?: string[]
}

/**
 * Build an `afterRead` hook that walks the named rich-text fields, finds
 * inline-image nodes, batch-fetches their target documents, and merges
 * `{ title, altText, image }` back into `relation.document`. Stale data
 * is overwritten; missing targets keep whatever was denormalised at write
 * time so the renderer always has *something* to show.
 *
 * Threads the request's `readContext` through every nested fetch so the
 * existing visited-set / read-budget / `afterReadFired` machinery applies
 * — same A→B→A guard `populate` and the link plugin's deferred hook use.
 *
 * Resolves a `BylineClient` lazily via the dynamic import below so this
 * module stays side-effect-free at admin-config evaluation time.
 */
export function inlineImageAfterRead(options: InlineImageAfterReadOptions) {
  const { richTextFields, sourceCollections } = options
  const allowedSources = sourceCollections ? new Set(sourceCollections) : null

  return async (ctx: AfterReadContext): Promise<void> => {
    const { doc, readContext } = ctx
    const fields = doc.fields as Record<string, unknown> | undefined
    if (!fields) return

    // Collect inline-image nodes across every named rich-text field.
    type Pending = { node: LexicalNodeLike; collectionPath: string; documentId: string }
    const pending: Pending[] = []

    for (const fieldName of richTextFields) {
      const root = getLexicalRoot(fields[fieldName])
      if (!root) continue
      for (const node of iterInlineImageNodes(root)) {
        const rel = node.relation
        const collectionPath = rel?.targetCollectionPath
        const documentId = rel?.targetDocumentId
        if (!collectionPath || !documentId) continue
        if (allowedSources != null && !allowedSources.has(collectionPath)) continue
        pending.push({ node, collectionPath, documentId })
      }
    }

    if (pending.length === 0) return

    // Group ids by source collection for batch fetching.
    const idsByCollection = new Map<string, Set<string>>()
    for (const p of pending) {
      let bucket = idsByCollection.get(p.collectionPath)
      if (!bucket) {
        bucket = new Set()
        idsByCollection.set(p.collectionPath, bucket)
      }
      bucket.add(p.documentId)
    }

    // Resolve a BylineClient lazily — admin-side this is the cached singleton
    // backed by the active server config. Other consumers are expected to
    // override the import path or wire their own client; we keep this module
    // dependent on `@/lib/byline-client` to avoid plumbing a `client` arg
    // through every collection definition.
    const { getAdminBylineClient } = await import('@/lib/byline-client')
    const client = getAdminBylineClient()

    // Batch-load each collection's docs in parallel.
    const fetched = new Map<string, Map<string, Record<string, any>>>()
    await Promise.all(
      Array.from(idsByCollection.entries()).map(async ([collectionPath, idSet]) => {
        const ids = Array.from(idSet)
        const result = await client.collection(collectionPath).find({
          where: { id: { $in: ids } },
          pageSize: ids.length,
          _readContext: readContext,
        })
        const byId = new Map<string, Record<string, any>>()
        for (const d of result.docs as Array<Record<string, any>>) {
          if (typeof d.id === 'string') byId.set(d.id, d)
        }
        fetched.set(collectionPath, byId)
      })
    )

    // Merge fresh `{ title, altText, image, sizes }` back into each node's
    // `relation.document`. Mutating in place — `afterRead` propagates these
    // mutations through the shaped response.
    for (const { node, collectionPath, documentId } of pending) {
      const target = fetched.get(collectionPath)?.get(documentId)
      if (!target) continue
      const targetFields = (target.fields ?? {}) as Record<string, any>
      const image = targetFields.image as StoredFileValue | undefined
      const sizesConfig = getCollectionDefinition(collectionPath)?.upload?.sizes
      const sizes = image ? deriveImageSizes(image, sizesConfig) : []

      const next: Record<string, any> = { ...(node.relation?.document ?? {}) }
      if (typeof targetFields.title === 'string') next.title = targetFields.title
      if (typeof targetFields.altText === 'string') next.altText = targetFields.altText
      if (image != null) next.image = image
      if (sizes.length > 0) next.sizes = sizes
      if (node.relation == null) continue
      node.relation.document = next
    }
  }
}
