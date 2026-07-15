/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Read-time splat resolver for the `docs` document tree (docs/04-collections/03-document-trees.md →
 * "Public URL resolution"). Shared by the HTML splat route and the `.md`
 * channel so both resolve a hierarchical URL the same way.
 *
 * Leaf-resolve + canonicalize: the *leaf* slug locates the document (slugs are
 * globally unique per collection + locale, so the intermediate segments never
 * participate in resolution — O(1) + O(depth)). The ancestor chain is derived
 * from the live tree and used only to build the canonical URL and to validate
 * reachability. The caller compares the requested chain to `chainSegments`:
 * equal ⇒ serve, different ⇒ 301 to the canonical form computed from the tree.
 *
 * Status-at-edge: in published mode `getAncestors` stops at the first
 * unpublished ancestor (a truncated chain). When `enforceSpine` is set we reject
 * a document whose resolved spine does not reach a root — an unpublished
 * mid-tree ancestor hides its whole subtree publicly (a 404), per the locked
 * decision. Preview reads pass `enforceSpine: false` so admins see the full
 * tree.
 */

import type { ClientDocument, CollectionHandle } from '@byline/client'

export interface DocAncestorLink {
  id: string
  path: string
  title: string
}

export interface DocTreeResolution<F> {
  doc: ClientDocument<F>
  /** Breadcrumb trail, root-first, excluding the document itself. */
  ancestors: DocAncestorLink[]
  /**
   * Canonical URL segments *after* the collection base (e.g.
   * `['getting-started', 'cli']`) — the ancestor paths followed by the
   * document's own path. Compare `chainSegments.join('/')` to the requested
   * splat to decide serve vs 301.
   */
  chainSegments: string[]
}

function titleOf(doc: { path: string; fields?: unknown }): string {
  const title = (doc.fields as Record<string, unknown> | undefined)?.title
  return typeof title === 'string' && title.length > 0 ? title : doc.path
}

/**
 * Resolve a `docs` document from a splat (`getting-started/cli`). Returns `null`
 * when the leaf does not resolve, or — under `enforceSpine` — when the spine is
 * broken by an unpublished ancestor (the caller turns `null` into a 404).
 */
export async function resolveDocTreeBySplat<F = Record<string, any>>(
  handle: CollectionHandle,
  options: {
    splat: string
    locale: string
    status: 'published' | 'any'
    enforceSpine: boolean
    populate?: Record<string, '*'>
  }
): Promise<DocTreeResolution<F> | null> {
  const { splat, locale, status, enforceSpine, populate } = options

  const requested = splat
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter((s) => s.length > 0)
  const leaf = requested.at(-1)
  if (leaf == null) return null

  const doc = await handle.findByPath<F>(leaf, { populate, locale, status })
  if (doc == null) return null

  const ancestors = await handle.getAncestors(doc.id, { status, locale })

  // Reachability: the topmost *resolved* node must be a root (or the document
  // must be unplaced). A non-null parent above the resolved chain means an
  // unpublished ancestor truncated the spine — unreachable in published mode.
  if (enforceSpine) {
    const topId = ancestors.at(0)?.id ?? doc.id
    const { placed, parentDocumentId, parentVisibility } = await handle.getTreeParent(topId, {
      status,
      locale,
    })
    if (parentVisibility === 'redacted' || (placed && parentDocumentId != null)) return null
  }

  const ancestorLinks: DocAncestorLink[] = ancestors.map((a) => ({
    id: a.id,
    path: a.path,
    title: titleOf(a),
  }))
  const chainSegments = [...ancestorLinks.map((a) => a.path), doc.path]

  return { doc: doc as ClientDocument<F>, ancestors: ancestorLinks, chainSegments }
}
