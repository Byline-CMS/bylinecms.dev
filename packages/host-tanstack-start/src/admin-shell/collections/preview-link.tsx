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
 *   2. Navigates the current tab to the document's preview URL via
 *      `window.location.assign(url)`.
 *
 * The preview URL comes from `CollectionAdminConfig.preview.url(doc, ctx)`
 * when configured; otherwise it falls back through the schema's
 * `CollectionDefinition.buildDocumentPath` (the single source of truth
 * the richtext embed walker also reads) and finally to the conventional
 * `/${collectionPath}/${doc.path}`. When the configured `url(...)`
 * returns `null` (missing slug, missing required relation, etc.), the
 * icon is not rendered at all — there is no public URL meaningful for
 * this document yet, so offering a preview link would just lead to a
 * 404. Hosts that need a locale prefix, query string, or other request-
 * scoped composition still write their own `preview.url`.
 *
 * The component does not load the document itself. Callers pass the
 * already-loaded `doc` from their route loader. The edit-view loader
 * applies a blanket depth-1 populate (picker projection) so direct
 * relation targets are available as `doc.fields.<name>?.document` —
 * `url(doc, ctx)` inherits that populated tree without further work.
 * Deeper hops or fields outside the picker projection are not available;
 * see `CollectionAdminConfig.preview` for the full contract.
 *
 * Two-step "enable cookie then navigate" intentionally avoids the
 * Payload-style `/routes/draft?url=...&secret=...` redirect handler:
 * `enablePreviewModeFn()` is itself the gate (it requires a valid admin
 * session before setting the cookie), so no shared secret needs to ride
 * in the URL.
 */

import { useState } from 'react'

import type { CollectionAdminConfig, PreviewDocument } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { ExternalLinkIcon, IconButton, useToastManager } from '@byline/ui/react'
import cx from 'classnames'

import { enablePreviewModeFn } from '../../server-fns/preview/index.js'
import { resolvePreviewUrl } from './resolve-preview-url.js'

export { resolvePreviewUrl } from './resolve-preview-url.js'

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

export const PreviewLink = ({
  collectionPath,
  doc,
  adminConfig,
  locale,
  className,
}: PreviewLinkProps) => {
  const toastManager = useToastManager()
  const { t } = useTranslation('byline-admin')
  const [busy, setBusy] = useState(false)

  const url = resolvePreviewUrl(doc, collectionPath, adminConfig, locale)
  if (url == null) return null

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      // Enable preview mode for the admin's browser session before
      // navigating. The viewer client on the front-end host reads the
      // cookie on subsequent requests and elevates the read context.
      await enablePreviewModeFn()
      window.location.assign(url)
    } catch (err) {
      toastManager.add({
        title: t('collections.preview.toastTitle'),
        description: t('collections.preview.failedDescription', {
          message: (err as Error).message,
        }),
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
      aria-label={t('collections.preview.openAriaLabel')}
      title={t('collections.preview.title')}
    >
      <ExternalLinkIcon width="20px" height="20px" className="byline-preview-link-icon" />
    </IconButton>
  )
}
