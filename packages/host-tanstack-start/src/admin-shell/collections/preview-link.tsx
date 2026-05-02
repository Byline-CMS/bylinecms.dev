/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-document preview affordance for the admin shell.
 *
 * Renders an external-link icon that, when clicked:
 *   1. Calls `enablePreviewModeFn()` to set the `byline_preview` cookie
 *      on the admin's session — so the front-end host's viewer client
 *      starts surfacing draft versions for this admin's subsequent
 *      requests.
 *   2. Opens the document's preview URL in a new tab via
 *      `window.open(url, '_blank', 'noopener,noreferrer')`.
 *
 * The preview URL comes from `CollectionAdminConfig.preview.url(doc, ctx)`
 * when configured; otherwise it falls back to the conventional
 * `/${collectionPath}/${doc.path}`. When the configured `url(...)` returns
 * `null` (missing slug, missing required relation, etc.), the icon is
 * not rendered at all — there is no public URL meaningful for this
 * document yet, so offering a preview link would just lead to a 404.
 *
 * The component does not load the document itself. Callers pass the
 * already-loaded `doc` from their route loader. If `preview.populate`
 * is configured, it's the loader's responsibility to apply that hint
 * when fetching the document so `url(doc, ctx)` sees the resolved
 * relation values it expects (e.g. `doc.fields.area?.document?.path`).
 *
 * Two-step "enable cookie then navigate" intentionally avoids the
 * Payload-style `/routes/draft?url=...&secret=...` redirect handler:
 * `enablePreviewModeFn()` is itself the gate (it requires a valid admin
 * session before setting the cookie), so no shared secret needs to ride
 * in the URL.
 */

import { useState } from 'react'

import type { CollectionAdminConfig, PreviewDocument } from '@byline/core'
import { ExternalLinkIcon, IconButton, useToastManager } from '@infonomic/uikit/react'
import cx from 'classnames'

import { enablePreviewModeFn } from '../../server-fns/preview/index.js'

export interface PreviewLinkProps {
  /** Collection path (e.g. `'news'`, `'pages'`). */
  collectionPath: string
  /** The loaded document — must include `id`, `path`, and `fields`. */
  doc: PreviewDocument
  /** Admin config for the collection. Read for `preview.url`. */
  adminConfig?: CollectionAdminConfig
  /** Current content locale (forwarded into `preview.url(doc, { locale })`). */
  locale?: string
  /** Optional className for the IconButton. */
  className?: string
}

/**
 * Resolve the preview URL for a doc against an admin config. Exported so
 * other surfaces (list-row preview links in the future) can share the
 * same fallback logic.
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
  // Default convention: collection lives at `/${collectionPath}/${path}`.
  // Returns null when the doc has no path yet (unsaved, awaiting slug).
  if (!doc.path) return null
  return `/${collectionPath}/${doc.path}`
}

export const PreviewLink = ({
  collectionPath,
  doc,
  adminConfig,
  locale,
  className,
}: PreviewLinkProps) => {
  const toastManager = useToastManager()
  const [busy, setBusy] = useState(false)

  const url = resolvePreviewUrl(doc, collectionPath, adminConfig, locale)
  if (url == null) return null

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      // Enable preview mode for the admin's browser session before opening
      // the URL. The viewer client on the front-end host reads the cookie
      // on subsequent requests and elevates the read context.
      await enablePreviewModeFn()
      // `noopener,noreferrer` so the opened tab can't reach back into
      // the admin window via `window.opener`.
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toastManager.add({
        title: 'Preview',
        description: `Could not enable preview mode: ${(err as Error).message}`,
        data: {
          intent: 'danger',
          iconType: 'danger',
          icon: true,
          close: true,
        },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <IconButton
      className={cx('byline-preview-link', className)}
      size="xs"
      variant="text"
      disabled={busy}
      onClick={handleClick}
      aria-label="Open preview in new tab"
      title="Preview"
    >
      <ExternalLinkIcon className="byline-preview-link-icon" />
    </IconButton>
  )
}
