'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { WorkflowStatus } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import cx from 'classnames'

import { LocalDateTime } from '../fields/local-date-time'
import styles from './form-renderer.module.css'
import type { PublishedVersionInfo } from './form-renderer'

/**
 * The status / metadata strip at the top of a document form — current
 * workflow status (suppressed for single-status workflows), last-modified and
 * created timestamps, and a "published live" indicator with an inline
 * Unpublish action when a previously-published version is still live.
 */
export const FormStatusDisplay = ({
  initialData,
  workflowStatuses,
  publishedVersion,
  onUnpublish,
}: {
  initialData?: Record<string, any>
  workflowStatuses?: WorkflowStatus[]
  publishedVersion?: PublishedVersionInfo | null
  onUnpublish?: () => Promise<void>
}) => {
  const { t } = useTranslation('byline-admin')
  const statusCode = initialData?.status
  const statusLabel = workflowStatuses?.find((s) => s.name === statusCode)?.label ?? statusCode
  // Single-status workflows (e.g. lookups) have no editorial lifecycle —
  // suppress the "Status: …" cell since there is nothing meaningful to convey.
  const showStatusCell = (workflowStatuses?.length ?? 0) > 1

  return (
    <div className={cx('byline-form-status', styles.status)}>
      <div className={cx('byline-form-status-meta', styles['status-meta'])}>
        {showStatusCell && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              {t('forms.status.label')}
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              {statusLabel}
            </span>
          </div>
        )}

        {initialData?.updatedAt != null && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              {t('forms.status.lastModified')}
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              <LocalDateTime value={initialData.updatedAt} />
            </span>
          </div>
        )}

        {initialData?.createdAt != null && (
          <div className={cx('byline-form-status-cell', styles['status-cell'])}>
            <span className={cx('byline-form-status-muted', styles['status-muted'])}>
              {t('forms.status.created')}
            </span>
            <span className={cx('byline-form-status-trunc', styles['status-trunc'])}>
              <LocalDateTime value={initialData.createdAt} />
            </span>
          </div>
        )}
      </div>

      {publishedVersion != null && (
        <div className={cx('byline-form-status-published', styles['status-published'])}>
          <span className={cx('byline-form-status-muted', styles['status-muted'])}>
            {t('forms.status.publishedLive')}{' '}
            {publishedVersion.updatedAt ? (
              <span>
                {t('forms.status.publishedOn', { date: new Date(publishedVersion.updatedAt) })}
              </span>
            ) : (
              ''
            )}
          </span>
          {onUnpublish && (
            <>
              {' '}
              <button
                type="button"
                onClick={onUnpublish}
                className={cx('byline-form-status-unpublish', styles['status-unpublish'])}
              >
                {t('common.actions.unpublish')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
