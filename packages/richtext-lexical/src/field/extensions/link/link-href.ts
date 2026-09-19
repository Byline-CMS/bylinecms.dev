/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Resolve a `LinkAttributes` to a renderable href, or `null` when no
 * usable target exists.
 *
 * React-free and DOM-free, so the editor, the markdown serializer and any
 * host renderer can share one definition of the internal-link fallback
 * chain (documented in `docs/04-collections/07-rich-text.md`):
 *
 *   1. `document._resolved === false` — the server-side walker could not
 *      find the target on its last pass. Return null; callers degrade.
 *   2. `document.path` starts with `/` — canonical, written by the walker
 *      via `buildDocumentPath`. Use as-is.
 *   3. `document.path` is a bare slug — compose `/${collectionPath}/${path}`.
 *      Covers legacy nodes and picker-time writes not yet walked.
 *   4. Anything else — null.
 *
 * `null` is never "render an empty href". It means the link is not
 * renderable, and each caller has its own way of degrading: the editor
 * withholds its cmd-click affordance, the markdown serializer emits the
 * image without a wrapper, the public renderer drops the anchor.
 */

import type { LinkAttributes } from '.'

export function resolveLinkHref(link: LinkAttributes | undefined | null): string | null {
  if (link == null) return null

  if (link.linkType === 'internal') {
    // Step 1 — walker explicitly marked the target as missing.
    if (link.document?._resolved === false) return null

    const path = link.document?.path
    if (typeof path !== 'string' || path.length === 0) return null
    // Step 2 — canonical path.
    if (path.startsWith('/')) return path
    // Step 3 — bare slug, generic compose fallback.
    if (link.targetCollectionPath) return `/${link.targetCollectionPath}/${path}`
    // Step 4 — nothing to compose against.
    return null
  }

  const url = link.url
  return typeof url === 'string' && url.length > 0 ? url : null
}
