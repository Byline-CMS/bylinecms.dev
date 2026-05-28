/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Pure (no React, no DOM) resolver for the admin Preview button's URL.
 * Lives in its own module so it can be unit-tested without dragging the
 * React UI graph of `preview-link.tsx` into a node-mode test run.
 */

import {
  type CollectionAdminConfig,
  getCollectionDefinition,
  type PreviewDocument,
} from '@byline/core'

/**
 * Resolve the preview URL for a doc against an admin config. Exported so
 * other surfaces (list-row preview links in the future) can share the
 * same fallback logic.
 *
 * Cascade:
 *   1. `adminConfig.preview.url(doc, { locale })` — wins outright when
 *      configured. The host can do anything (locale prefix, query
 *      string, conditional return-null).
 *   2. `CollectionDefinition.buildDocumentPath(doc, { collectionPath })`
 *      — the schema-side hook the richtext embed walker also reads.
 *      Locale-agnostic by contract; hosts that need a locale prefix
 *      keep their own `preview.url`.
 *   3. Generic compose `/${collectionPath}/${doc.path}` — last-resort
 *      convention for collections with no schema-side hook.
 *
 * Returns:
 *   - `string`  → URL to open
 *   - `null`    → no preview URL meaningful for this doc; hide affordance
 */
export function resolvePreviewUrl(
  doc: PreviewDocument,
  collectionPath: string,
  adminConfig: CollectionAdminConfig | undefined,
  locale: string | undefined
): string | null {
  if (adminConfig?.preview) {
    return adminConfig.preview.url(doc, { locale })
  }
  // Schema-side default — same hook the richtext embed walker reads, so
  // the public path and the admin Preview button agree by construction.
  const definition = getCollectionDefinition(collectionPath)
  if (definition?.buildDocumentPath != null) {
    try {
      const built = definition.buildDocumentPath(doc, { collectionPath })
      if (typeof built === 'string') return built
      if (built === null) return null
    } catch {
      // Fall through to generic compose — matches the embed walker's
      // branch-A posture (don't take the render path down with the hook).
    }
  }
  // Generic compose: collection lives at `/${collectionPath}/${path}`.
  // Returns null when the doc has no path yet (unsaved, awaiting slug).
  if (!doc.path) return null
  return `/${collectionPath}/${doc.path}`
}
