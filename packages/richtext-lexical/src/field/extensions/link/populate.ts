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
 * `attributes.linkType` is `'internal'`. The copied target values (`title`,
 * `path`) are **replaced, never merged**: a value the current, permitted
 * target result does not supply is removed rather than kept from an earlier
 * copy. The link's identity (`targetDocumentId` / `targetCollectionPath`)
 * and its authored children are never touched. Branches:
 *
 *   - **Found, path produced** — sets `document.title` from the target's
 *     `useAsTitle` field (falling back to `title`), or removes it when the
 *     result has none; sets `document.path` from the collection's
 *     `buildDocumentPath` hook, or from `/${collectionPath}/${target.path}`
 *     when the hook is absent or returns `null`; and clears any prior
 *     `document._resolved` flag.
 *
 *   - **Found, no path** (branch A) — the hook threw (logged at `info`) or
 *     no usable path could be composed. The old copied path is removed and
 *     `document._resolved = false`, so the renderer strips the `<a>` and
 *     renders the children as plain text. A stale path is never reused, and
 *     an unresolved link is only reactivated by a path actually produced.
 *
 *   - **Target not found** (branch B) — logs at `warn` level, deletes
 *     `document.title` and `document.path`, and sets
 *     `document._resolved = false`. Persisted state remains a complete
 *     record — re-linking is possible whenever the editor returns.
 *
 * Hard reader errors (DB unreachable, transport failures) propagate (branch
 * C). On a read, the whole read fails, so no stale snapshot is served. On a
 * save, `document-lifecycle` catches per leaf and leaves the persisted leaf
 * untouched.
 *
 * `linkType: 'custom'` links carry a literal URL and have no relation
 * envelope; they're skipped. Auto-link nodes (`type: 'autolink'`) are
 * also skipped — they're derived from URL patterns and never internal.
 */

import { getCollectionDefinition, getLogger } from '@byline/core'

import type {
  LexicalNodeLike,
  LexicalNodeVisitor,
  PendingHydration,
} from '../../lexical-populate-shared'

/**
 * Build the `apply` / `applyMissing` pair that refreshes an internal-link
 * relation envelope in place.
 *
 * Shared by `linkVisitor` (where the envelope is `node.attributes`) and by
 * the inline-image plugin's `inlineImageLinkVisitor` (where it is
 * `node.link`). Both carry the same `DocumentRelation` shape and want the
 * same three branches, so the resolution rules documented above live here
 * once rather than being copied per node type.
 *
 * `envelope` is mutated in place — the caller owns where it hangs off the
 * node.
 */
export function createInternalLinkHydration(
  envelope: Record<string, any>,
  collectionPath: string,
  documentId: string
): Pick<PendingHydration, 'apply' | 'applyMissing'> {
  return {
    apply(target: Record<string, any>) {
      const definition = getCollectionDefinition(collectionPath)
      const useAsTitle = definition?.useAsTitle ?? 'title'
      const targetFields = (target.fields ?? {}) as Record<string, any>
      const next: Record<string, any> = { ...(envelope.document ?? {}) }

      // Title — `useAsTitle` lookup with `title` fallback. Replaced, never
      // merged: when the current (permitted) target result supplies no title,
      // a previously copied title is removed rather than kept. A withheld or
      // redacted translation must not survive as a stale copy.
      const title = targetFields[useAsTitle]
      if (typeof title === 'string' && title.length > 0) {
        next.title = title
      } else {
        delete next.title
      }

      // Path — buildDocumentPath, then generic compose fallback. A hook that
      // throws is logged (so operators can find the bug without it taking the
      // save / read down) and treated as "no path produced" (branch A).
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

      let path: string | undefined
      if (!pathThrew) {
        if (typeof built === 'string') {
          path = built
        } else {
          // Generic compose fallback. Only fires when the target has a
          // non-empty `path` — `/${collectionPath}/` or
          // `/${collectionPath}/undefined` are not usable paths.
          const targetPath = target.path as string | undefined
          if (typeof targetPath === 'string' && targetPath.length > 0) {
            path = `/${collectionPath}/${targetPath}`
          }
        }
      }

      if (path != null) {
        next.path = path
        // Found-and-resolved: clear any stale miss flag from a prior pass.
        delete next._resolved
      } else {
        // Branch A — no usable current path. Never reuse the old copy.
        delete next.path
        next._resolved = false
      }

      envelope.document = next
    },
    applyMissing() {
      // Branch B — target deleted between picker and walker.
      getLogger().warn({ collectionPath, documentId }, 'internal link target not found')
      const next: Record<string, any> = { ...(envelope.document ?? {}) }
      delete next.title
      delete next.path
      next._resolved = false
      envelope.document = next
    },
  }
}

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
      ...createInternalLinkHydration(attributes, collectionPath, documentId),
    }
  },
}
