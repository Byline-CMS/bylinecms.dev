/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shared utilities for the Lexical adapter's server-side populate. Each
 * Lexical plugin contributes a `LexicalNodeVisitor` describing what it
 * looks for and how to refresh it; the driver below walks each rich-text
 * value once, dispatches across every visitor, batches per source
 * collection, and applies the refresh.
 *
 * Pure / framework-agnostic. No React, no DOM, no Lexical runtime — safe
 * to import from the package's `server` entry.
 */

import type { BylineClient } from '@byline/client'
import type { ReadContext } from '@byline/core'

/**
 * Lexical-shaped node — only the fields the visitors need to read or
 * mutate. Carries an unknown `children` array because nodes nest
 * (paragraphs, lists, tables, …). Per-node-type fields (link / inline-
 * image attributes) are spread flat onto the node and accessed
 * structurally rather than through a discriminated union, since each
 * visitor knows its own shape.
 */
export interface LexicalNodeLike {
  type?: string
  children?: LexicalNodeLike[]
  // Flattened relation-envelope fields — present on `inline-image` nodes
  // and (during transitional shapes) some legacy link nodes.
  targetDocumentId?: string
  targetCollectionId?: string
  targetCollectionPath?: string
  document?: Record<string, any>
  // Link-specific — discriminates between custom-URL and internal-document
  // links. Only `'internal'` links carry a relation envelope.
  linkType?: 'custom' | 'internal'
  // Catch-all for the rest of a node's attributes. `attributes` exists on
  // some node shapes (link nodes wrap attrs in an explicit `attributes`
  // object).
  attributes?: Record<string, any>
}

interface LexicalRoot {
  root?: LexicalNodeLike
}

/**
 * Read a rich-text field value (Lexical JSON object or stringified) and
 * return its root node, or `null` if the value is not a parseable Lexical
 * tree. Tolerates both shapes Byline has shipped — the wrapped form
 * (`{ root: { … } }`) and the raw root node.
 */
export function getLexicalRoot(value: unknown): LexicalNodeLike | null {
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

/**
 * Top-down recursive walk over a Lexical tree. Yields every node including
 * the root. Mutating fields on yielded nodes is safe — the walk doesn't
 * revisit and is order-independent for our visitors.
 */
export function* iterAllNodes(node: LexicalNodeLike): Generator<LexicalNodeLike, void, void> {
  if (node == null) return
  yield node
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      yield* iterAllNodes(child)
    }
  }
}

/**
 * One pending hydration unit. The visitor decides whether a node matches,
 * and if so produces a `PendingHydration` describing how to refresh it.
 */
export interface PendingHydration {
  node: LexicalNodeLike
  collectionPath: string
  documentId: string
  /**
   * Apply the freshly-fetched target document to the node. Mutates `node`
   * in place; `target.fields` is the shaped collection record. Receives
   * the full target so the visitor can pick whatever projection it cares
   * about. Invoked by the driver only when the target was found.
   */
  apply: (target: Record<string, any>) => void
  /**
   * Optional handler invoked by the driver when the target document could
   * not be fetched — i.e. it was deleted between the picker's write and
   * this walk. Lets the visitor mark the node with degraded state
   * (e.g. `document._resolved = false` on internal-link nodes) so the
   * renderer can react. Omit on visitors that prefer the older "silent
   * skip" behaviour; the driver no-ops when absent.
   */
  applyMissing?: () => void
}

/**
 * Visitor contract — one per node type that participates in populate.
 * `match` is called for every node in the tree; when it returns a
 * `PendingHydration`, the driver enqueues it for batch fetch.
 */
export interface LexicalNodeVisitor {
  match: (node: LexicalNodeLike) => PendingHydration | null
}

interface RunPopulateOptions {
  client: BylineClient
  readContext: ReadContext
  visitors: LexicalNodeVisitor[]
  /**
   * One or more rich-text values to walk. The framework's read pipeline
   * calls the registered populate function once per leaf, so the typical
   * shape here is a single-element array — but the driver supports
   * multiple values for batching across an entire document tree if a
   * future caller wants the optimisation.
   */
  values: unknown[]
}

/**
 * Walk every supplied rich-text value, collect the union of pending
 * hydrations across all visitors, batch-fetch by source collection, and
 * apply.
 *
 * `readContext` is accepted (factories thread it through from
 * `RichTextPopulateContext` / `RichTextEmbedContext`) but currently unused —
 * the batch fetch goes straight to `getDocumentsByDocumentIds` and doesn't
 * recurse into populate or `afterRead`, so there's no visited-set or
 * read-budget state to share. Retained on the options shape so a future
 * visitor that performs nested populate can opt back in without another
 * contract churn.
 */
export async function runLexicalPopulate(options: RunPopulateOptions): Promise<void> {
  const { client, visitors, values } = options

  const pending: PendingHydration[] = []
  for (const value of values) {
    const root = getLexicalRoot(value)
    if (!root) continue
    for (const node of iterAllNodes(root)) {
      for (const visitor of visitors) {
        const item = visitor.match(node)
        if (item == null) continue
        pending.push(item)
      }
    }
  }

  if (pending.length === 0) return

  const idsByCollection = new Map<string, Set<string>>()
  for (const p of pending) {
    let bucket = idsByCollection.get(p.collectionPath)
    if (!bucket) {
      bucket = new Set()
      idsByCollection.set(p.collectionPath, bucket)
    }
    bucket.add(p.documentId)
  }

  // Fetch directly through the adapter rather than the client's `find()` —
  // `parseWhere` has no handler for `id`, so `find({ where: { id: { $in } } })`
  // silently dropped the filter and returned arbitrary docs ordered by
  // `created_at desc`. This is the same primitive relation populate uses
  // (`packages/core/src/services/populate.ts`) when it batches by document id.
  const fetched = new Map<string, Map<string, Record<string, any>>>()
  await Promise.all(
    Array.from(idsByCollection.entries()).map(async ([collectionPath, idSet]) => {
      const ids = Array.from(idSet)
      const collectionId = await client.resolveCollectionId(collectionPath)
      const rawDocs = await client.db.queries.documents.getDocumentsByDocumentIds({
        collection_id: collectionId,
        document_ids: ids,
        readMode: 'published',
      })
      const byId = new Map<string, Record<string, any>>()
      for (const raw of rawDocs as Array<Record<string, any>>) {
        if (typeof raw.document_id !== 'string') continue
        // Normalise the raw storage shape (`document_id` / `path` / `status` /
        // `fields`) to the `{ id, path, status, fields }` shape the visitors
        // expect — matches the shaped `ClientDocument` the previous `find()`
        // path returned.
        byId.set(raw.document_id, {
          id: raw.document_id,
          path: raw.path,
          status: raw.status,
          fields: raw.fields,
        })
      }
      fetched.set(collectionPath, byId)
    })
  )

  for (const p of pending) {
    const target = fetched.get(p.collectionPath)?.get(p.documentId)
    if (target) {
      p.apply(target)
    } else {
      p.applyMissing?.()
    }
  }
}
