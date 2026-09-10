'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Full ranking for one dashboard card, paged client-side.
 *
 * The dashboard cards show a short preview so the lists band stays even
 * regardless of traffic. This modal shows the whole set behind a card's
 * "View all" action. A `source` may be a ready list (countries are fully
 * loaded with the dashboard) or a loader invoked once each time the modal
 * opens (pages, downloads and referrers fetch a larger top-N on demand).
 *
 * The caption keeps the dashboard's honesty rule: when the loaded rows are
 * a top-N slice of a larger set it says so alongside the page range.
 */

import type React from 'react'
import { useEffect, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, LoaderRing, Modal, Pagination } from '@byline/ui/react'
import cx from 'clsx'

import styles from './dashboard.module.css'
import { type AnalyticsTone, pageWindow, type RankedListSource, RankingRows } from './ranking.js'

export type RankedListSourceInput = RankedListSource | (() => Promise<RankedListSource>)

export interface RankedListModalProps {
  isOpen: boolean
  onDismiss(): void
  title: string
  tone: AnalyticsTone
  locale: string
  source: RankedListSourceInput
  pageSize?: number
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: RankedListSource }
  | { status: 'error' }

export function RankedListModal({
  isOpen,
  onDismiss,
  title,
  tone,
  locale,
  source,
  pageSize = 25,
}: RankedListModalProps): React.JSX.Element {
  const { t } = useTranslation('byline-admin')
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!isOpen) {
      setState({ status: 'idle' })
      setPage(1)
      return
    }
    if (typeof source !== 'function') {
      setState({ status: 'ready', data: source })
      return
    }
    let current = true
    setState({ status: 'loading' })
    source()
      .then((data) => {
        if (current) setState({ status: 'ready', data })
      })
      .catch(() => {
        if (current) setState({ status: 'error' })
      })
    return () => {
      current = false
    }
  }, [isOpen, source])

  const data = state.status === 'ready' ? state.data : undefined
  const loaded = data?.rows.length ?? 0
  const window = pageWindow(loaded, pageSize, page)
  const visible = data?.rows.slice(window.start, window.end) ?? []
  const truncated = data != null && data.total > loaded
  const caption = data
    ? [
        loaded === 0
          ? undefined
          : t('analytics.range', {
              from: window.start + 1,
              to: window.end,
              total: loaded,
            }),
        truncated ? t('analytics.topOf', { shown: loaded, total: data.total }) : undefined,
      ]
        .filter((value): value is string => value != null)
        .join(' · ')
    : undefined

  return (
    <Modal isOpen={isOpen} onDismiss={onDismiss} closeOnOverlayClick>
      <Modal.Container className={cx('byline-analytics-modal', styles.modal)}>
        <Modal.Header>
          <h2>{title}</h2>
          {caption != null && caption.length > 0 && (
            <p className={cx('muted', 'byline-analytics-modal-caption', styles.modalCaption)}>
              {caption}
            </p>
          )}
        </Modal.Header>
        <Modal.Content className={cx('byline-analytics-modal-content', styles.modalContent)}>
          {state.status === 'loading' && (
            <div role="status" aria-live="polite" className={styles.modalStatus}>
              <LoaderRing size={28} aria-hidden="true" />
              <span className={styles.srOnly}>{t('common.loading')}</span>
            </div>
          )}
          {state.status === 'error' && (
            <div role="alert">
              <Alert intent="danger" close={false}>
                {t('analytics.loadError')}
              </Alert>
            </div>
          )}
          {data != null && loaded === 0 && <p className="muted">{t('analytics.empty')}</p>}
          {data != null && loaded > 0 && <RankingRows rows={visible} tone={tone} locale={locale} />}
        </Modal.Content>
        <Modal.Actions className={cx('byline-analytics-modal-actions', styles.modalActions)}>
          {window.pageCount > 1 ? (
            <Pagination
              variant="dashboard"
              count={window.pageCount}
              page={Math.min(page, window.pageCount)}
              onChange={(_event, next) => setPage(next)}
            >
              <Pagination.Root ariaLabel={t('analytics.pager')}>
                <Pagination.Pager />
              </Pagination.Root>
            </Pagination>
          ) : (
            <span />
          )}
          <Button type="button" size="sm" variant="outlined" onClick={onDismiss}>
            {t('common.actions.close')}
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
