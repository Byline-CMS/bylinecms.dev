'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'

import { contentLabelKey, joinLabels } from './content-labels'
import { useNoticeText } from './use-notice-text'

import './adapted-notice.css'

/**
 * Shown when stored content held a structure this field no longer
 * supports and it was adapted for editing.
 *
 * Inline and non-blocking: the content is editable, and the adaptation
 * only reaches storage if the reader actually saves an edit.
 */
export function AdaptedNotice(): React.JSX.Element {
  const { t } = useNoticeText()
  return (
    <div className="byline-richtext-notice byline-richtext-notice--adapted" role="status">
      {t('richtext.adapted.notice')}
    </div>
  )
}

/**
 * Shown when stored content holds something with no safe conversion —
 * an image, an embed, or a node type this build does not know.
 *
 * Those carry information no structural rewrite can preserve: an inline
 * image has a media relation and a caption held in a nested editor.
 * Discarding them silently would be worse than declining to edit, so the
 * field opens read-only rather than adapting.
 */
export function UnsupportedContentNotice({
  unsupportedTypes,
}: {
  unsupportedTypes: string[]
}): React.JSX.Element {
  const { t, locale } = useNoticeText()

  // Known types get a readable name; anything else keeps its id, so a
  // node from a site's own extension still produces a usable message.
  const labels = unsupportedTypes.map((type) => {
    const key = contentLabelKey(type)
    return key != null ? t(key) : type
  })

  return (
    <div className="byline-richtext-notice byline-richtext-notice--refused" role="alert">
      <p>{t('richtext.unsupported.notice', { items: joinLabels(labels, locale) })}</p>
      <p>{t('richtext.unsupported.action')}</p>
    </div>
  )
}
