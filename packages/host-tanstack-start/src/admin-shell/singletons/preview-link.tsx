'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import type { SingletonAdminConfig, SingletonPreviewDocument } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { ExternalLinkIcon, IconButton, useToastManager } from '@byline/ui/react'
import cx from 'clsx'

import { enablePreviewModeFn } from '../../server-fns/preview/index.js'

/**
 * Explicit-preview-only singleton affordance. A singleton's stored path is
 * internal identity metadata, so unlike collection previews there is no
 * schema or conventional path fallback.
 */
export function SingletonPreviewLink({
  doc,
  adminConfig,
  locale,
  className,
}: {
  doc: SingletonPreviewDocument
  adminConfig: SingletonAdminConfig
  locale?: string
  className?: string
}) {
  const toastManager = useToastManager()
  const { t } = useTranslation('byline-admin')
  const [busy, setBusy] = useState(false)
  const url = adminConfig.preview?.url(doc, { locale }) ?? null

  if (url == null) return null

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      await enablePreviewModeFn()
      window.location.assign(url)
    } catch (err) {
      toastManager.add({
        title: t('collections.preview.toastTitle'),
        description: t('collections.preview.failedDescription', {
          message: (err as Error).message,
        }),
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
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
