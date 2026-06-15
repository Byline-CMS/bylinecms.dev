/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'

import { Shimmer } from '@byline/ui/react'

/**
 * Skeleton shown while the editor module graph is loading. Composes the
 * `Shimmer` primitive into a document-shaped layout — a heading, a couple
 * of paragraphs, an inset image, a sub-heading, then more text — so the
 * placeholder reads as document-shaped content rather than a flat stack of
 * identical rows.
 *
 * Shared by both the outer `lexicalEditor()` Suspense fallback (while the
 * editor's lazy module graph loads) and the inner `EditorField` Suspense
 * fallback, so the visible cold-load sequence stays consistent throughout.
 */
export function EditorPlaceholder(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Heading (h1) */}
      <Shimmer variant="rectangular" width="60%" height="1.75rem" />

      {/* Opening paragraph */}
      <Shimmer variant="text" lines={4} lineHeight="1.15rem" />

      {/* Inset image / media block */}
      <Shimmer variant="rectangular" width="100%" height="12rem" />

      {/* Sub-heading (h2) */}
      <Shimmer variant="rectangular" width="40%" height="1.35rem" />

      {/* Closing paragraphs */}
      <Shimmer variant="text" lines={6} lineHeight="1.15rem" />
    </div>
  )
}
