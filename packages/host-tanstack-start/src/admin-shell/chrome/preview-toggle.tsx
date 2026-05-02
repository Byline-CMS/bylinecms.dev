/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Drawer-side toggle for front-end preview mode — the source-of-truth
 * affordance for the `byline_preview` cookie.
 *
 * Sits above Account in the menu drawer. Reflects the current cookie
 * state (which is httpOnly, so we read it via `getPreviewStateFn`) and
 * flips it via `enablePreviewModeFn` / `disablePreviewModeFn`. The
 * per-document `<PreviewLink>` icon also enables the cookie as a side
 * effect of clicking through, but the toggle is what makes the state
 * visible and reversible from the admin UI itself.
 *
 * Renders nothing until the initial cookie state has resolved — keeps
 * the toggle from flickering ON→OFF on first paint.
 */

import { useEffect, useState } from 'react'

import { EyeClosedIcon, EyeOpenIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import {
  disablePreviewModeFn,
  enablePreviewModeFn,
  getPreviewStateFn,
} from '../../server-fns/preview/index.js'

interface PreviewToggleProps {
  compact: boolean
}

export function PreviewToggle({ compact }: PreviewToggleProps) {
  const [preview, setPreview] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getPreviewStateFn()
      .then((res) => {
        if (!cancelled) setPreview(res.preview)
      })
      .catch(() => {
        if (!cancelled) setPreview(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async () => {
    if (busy || preview == null) return
    setBusy(true)
    try {
      if (preview) {
        await disablePreviewModeFn()
        setPreview(false)
      } else {
        await enablePreviewModeFn()
        setPreview(true)
      }
    } catch {
      // No toast surface from inside the drawer; revert by re-fetching.
      try {
        const res = await getPreviewStateFn()
        setPreview(res.preview)
      } catch {
        setPreview(false)
      }
    } finally {
      setBusy(false)
    }
  }

  // Hide entirely until first read resolves so the label doesn't flicker.
  if (preview == null) return null

  const label = preview ? 'Preview ON' : 'Preview OFF'
  const icon = preview ? (
    <EyeOpenIcon width="20px" height="20px" />
  ) : (
    <EyeClosedIcon width="20px" height="20px" />
  )

  return (
    <li className={cx('menu-item byline-preview-toggle', { compact, active: preview })}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        aria-label={preview ? 'Disable preview mode' : 'Enable preview mode'}
        title={
          preview ? 'Drafts are visible on the public site' : 'Public site shows published only'
        }
      >
        <span className="icon">{icon}</span>
        <span className="label">{label}</span>
      </button>
    </li>
  )
}
