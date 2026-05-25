/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server-side visitor for the link plugin. Pure / framework-agnostic —
 * imported from the package's `server` entry by both the read-time
 * populate adapter and the write-time embed adapter. The two modes share
 * the same visitor; only the trigger point differs.
 *
 * Refreshes `attributes.document` on `link` nodes whose
 * `attributes.linkType` is `'internal'`. Three branches:
 *
 *   - **Found** — sets `document.title` to the target's `useAsTitle`
 *     field value (falling back to `title` when `useAsTitle` is not
 *     defined), composes `document.path` via the collection's
 *     `buildDocumentPath` hook (with `/${collectionPath}/${target.path}`
 *     as the generic fallback when the hook is absent or returns
 *     `null`), and clears any prior `document._resolved` flag.
 *
 *   - **Hook threw** (branch A) — logs at `info` level and leaves
 *     `document.path` and `document._resolved` untouched. The picker-
 *     time embedded value (if any) stays in place; the renderer's
 *     fallback chain copes.
 *
 *   - **Target not found** (branch B) — logs at `warn` level, deletes
 *     `document.title` and `document.path`, and sets
 *     `document._resolved = false` so the renderer strips the `<a>`
 *     wrapper and renders the link's children as plain text. Persisted
 *     state remains a complete record — re-linking is possible whenever
 *     the editor returns.
 *
 * Hard errors (DB unreachable, transport-level failures) propagate to
 * the caller — `document-lifecycle` / the read pipeline — which catch
 * per-field and leave the persisted state untouched (branch C).
 *
 * `linkType: 'custom'` links carry a literal URL and have no relation
 * envelope; they're skipped. Auto-link nodes (`type: 'autolink'`) are
 * also skipped — they're derived from URL patterns and never internal.
 */

import { getCollectionDefinition, getLogger } from '@byline/core'

import type { LexicalNodeLike, LexicalNodeVisitor } from '../../lexical-populate-shared'

export const linkVisitor: LexicalNodeVisitor = {
  match(node: LexicalNodeLike) {
    if (node.type !== 'link') return null
    const attributes = node.attributes
    if (attributes == null) return null
    if (attributes.linkType !== 'internal') return null
    const collectionPath = attributes.targetCollectionPath as string | undefined
    const documentId = attributes.targetDocumentId as string | undefined
    if (!collectionPath || !documentId) return null

    return {
      node,
      collectionPath,
      documentId,
      apply(target: Record<string, any>) {
        const definition = getCollectionDefinition(collectionPath)
        const useAsTitle = definition?.useAsTitle ?? 'title'
        const targetFields = (target.fields ?? {}) as Record<string, any>
        const next: Record<string, any> = { ...(attributes.document ?? {}) }

        // Title — `useAsTitle` lookup with `title` fallback.
        const title = targetFields[useAsTitle]
        if (typeof title === 'string' && title.length > 0) {
          next.title = title
        }

        // Path — buildDocumentPath, then generic compose fallback.
        // Branch A: hook threw — leave any existing `document.path`
        // untouched and surface a log line so operators can find the
        // bug without it taking the save / read down with it.
        let pathThrew = false
        let built: string | null | undefined
        if (definition?.buildDocumentPath != null) {
          try {
            built = definition.buildDocumentPath(
              {
                id: target.id as string,
                path: target.path as string,
                status: target.status as string,
                fields: targetFields,
              },
              { collectionPath }
            )
          } catch (err) {
            pathThrew = true
            getLogger().info({ collectionPath, documentId, err }, 'buildDocumentPath threw')
          }
        }

        if (!pathThrew) {
          if (typeof built === 'string') {
            next.path = built
          } else {
            // Generic compose fallback. Only fires when the target has a
            // non-empty `path` — otherwise we'd produce `/${collectionPath}/`
            // or `/${collectionPath}/undefined`, both of which are worse
            // than leaving the previous value alone.
            const targetPath = target.path as string | undefined
            if (typeof targetPath === 'string' && targetPath.length > 0) {
              next.path = `/${collectionPath}/${targetPath}`
            }
          }
        }

        // Found-and-resolved: clear any stale miss flag from a prior pass.
        if ('_resolved' in next) {
          delete next._resolved
        }

        attributes.document = next
      },
      applyMissing() {
        // Branch B — target deleted between picker and walker.
        getLogger().warn({ collectionPath, documentId }, 'internal link target not found')
        const next: Record<string, any> = { ...(attributes.document ?? {}) }
        delete next.title
        delete next.path
        next._resolved = false
        attributes.document = next
      },
    }
  },
}
