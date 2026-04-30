/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { WorkflowStatus } from '@byline/core'
import {
  WORKFLOW_STATUS_ARCHIVED,
  WORKFLOW_STATUS_DRAFT,
  WORKFLOW_STATUS_PUBLISHED,
} from '@byline/core'
import { Badge } from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './status-badge.module.css'

function statusIntent(status: string): 'success' | 'warning' | 'info' | 'noeffect' {
  switch (status) {
    case WORKFLOW_STATUS_PUBLISHED:
      return 'success'
    case WORKFLOW_STATUS_DRAFT:
      return 'warning'
    case WORKFLOW_STATUS_ARCHIVED:
      return 'info'
    default:
      return 'noeffect'
  }
}

/**
 * Compact badge for workflow status values. Maps the three built-in
 * statuses (draft, published, archived) to semantic intents and falls
 * back to `noeffect` for any custom workflow statuses.
 *
 * When `hasPublishedVersion` is true and the current status is not
 * `published`, a small green dot is rendered before the badge to
 * indicate that a published version is live.
 *
 * Stable override handles: `.byline-status-badge-wrap`,
 * `.byline-status-badge-dot`, `.byline-status-badge`.
 */
export const StatusBadge = ({
  status,
  workflowStatuses,
  hasPublishedVersion,
}: {
  status: string
  workflowStatuses: WorkflowStatus[]
  hasPublishedVersion?: boolean
}) => {
  const label = workflowStatuses.find((s) => s.name === status)?.label ?? String(status ?? '')

  return (
    <span className={cx('byline-status-badge-wrap', styles.wrap)}>
      {hasPublishedVersion === true && status !== 'published' && (
        <span
          title="A published version is live"
          className={cx('byline-status-badge-dot', styles.dot)}
        />
      )}
      <Badge intent={statusIntent(status)} className={cx('byline-status-badge', styles.badge)}>
        {label}
      </Badge>
    </span>
  )
}
