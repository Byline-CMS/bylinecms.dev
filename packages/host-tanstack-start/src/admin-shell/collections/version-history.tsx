/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Fragment, lazy, type ReactNode, Suspense, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { CloseIcon, IconButton, Modal, Select, Table } from '@byline/ui/react'
import cx from 'clsx'

import { RouterPager } from '../chrome/router-pager.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './history.module.css'
import { RestoreVersionModal } from './restore-version-modal.js'

// Lazy-load DiffModal because react-diff-viewer-continued uses a web worker
// bundle that cannot be resolved by Node during SSR.
const DiffModal = lazy(() => import('@byline/admin/react').then((m) => ({ default: m.DiffModal })))

export interface VersionHistoryDocument extends Record<string, unknown> {
  id: string
  versionId?: string
  status: string
  createdAt: string
  createdBy?: string
  eventType?: string
  fields?: Record<string, unknown>
}

export interface VersionHistoryData {
  docs: VersionHistoryDocument[]
  meta: {
    total: number
    page: number
    pageSize: number
    totalPages: number
    order?: string
    desc?: boolean
  }
  /** Admin-resolved acting-user labels keyed by the raw version actor id. */
  actors?: Record<string, { label: string }>
}

export interface VersionHistoryRowContext {
  document: VersionHistoryDocument
  versionId: string | undefined
  versionNumber: number
  currentVersionId: string | null
  actorLabel: string
  actionLabel: string
  openCompare: () => void
  openRestore: () => void
}

/**
 * Resource-specific table columns. Collection history projects configured
 * columns; singleton history supplies its fixed status/time/actor/restore
 * presentation so restore never depends on a `useAsTitle` field.
 */
export interface VersionHistoryRowPresentation {
  headers: ReactNode
  auditColSpan: number
  renderCells: (context: VersionHistoryRowContext) => ReactNode
}

export type HistoricalVersionLoader = (
  resourcePath: string,
  documentId: string,
  versionId: string,
  locale: string | undefined
) => Promise<Record<string, unknown>>

const AUDIT_ACTION_KEYS: Record<string, string> = {
  create: 'collections.history.audit.actionCreate',
  update: 'collections.history.audit.actionUpdate',
  restore: 'collections.history.audit.actionRestore',
  copy_to_locale: 'collections.history.audit.actionCopyToLocale',
  delete_locale: 'collections.history.audit.actionDeleteLocale',
}

export function HistoryStats({ total }: { total: number }) {
  return (
    <span className={cx('byline-coll-history-stats', styles.stats)}>{formatNumber(total, 0)}</span>
  )
}

function padRows(value: number) {
  return Array.from({ length: Math.max(0, value) }).map((_, index) => (
    <div
      key={`empty-row-${
        // biome-ignore lint/suspicious/noArrayIndexKey: filler rows have no stable identity
        index
      }`}
      className={cx('byline-coll-history-pad-row', styles.padRow)}
    >
      &nbsp;
    </div>
  ))
}

export function VersionHistoryCore({
  data,
  resourcePath,
  documentId,
  currentDocument,
  locale,
  rowPresentation,
  loadHistoricalVersion,
  onPageSizeChange,
  restoreVersion,
  onRestoreComplete,
}: {
  data: VersionHistoryData
  resourcePath: string
  documentId: string
  currentDocument?: Record<string, unknown> | null
  locale?: string
  rowPresentation: VersionHistoryRowPresentation
  loadHistoricalVersion: HistoricalVersionLoader
  onPageSizeChange: (pageSize: number) => void
  restoreVersion: (versionId: string) => Promise<unknown>
  onRestoreComplete: () => void | Promise<void>
}) {
  const { t } = useTranslation('byline-admin')
  const [selectedVersion, setSelectedVersion] = useState<{
    versionId: string
    label: string
  } | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<{
    versionId: string
    label: string
    versionNumber: number
  } | null>(null)
  const currentVersionId =
    currentDocument && typeof currentDocument.versionId === 'string'
      ? currentDocument.versionId
      : null

  return (
    <>
      <div className={cx('byline-coll-history-options', styles.options)}>
        <RouterPager
          page={data.meta.page}
          count={data.meta.totalPages}
          showFirstButton
          showLastButton
          componentName="pagerTop"
          aria-label={t('collections.list.pagerTopAriaLabel')}
        />
      </div>
      <Table.Container className={cx('byline-coll-history-table-wrap', styles.tableWrap)}>
        <Table>
          <Table.Header>
            <Table.Row>
              <th
                scope="col"
                className={cx('byline-coll-history-col-version', styles.colVersion)}
              />
              {rowPresentation.headers}
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {data.docs.map((document, rowIndex) => {
              const versionId = document.versionId
              const { total, page, pageSize, desc } = data.meta
              const versionNumber = desc
                ? total - (page - 1) * pageSize - rowIndex
                : (page - 1) * pageSize + rowIndex + 1
              // A present-but-unresolved id is a deleted user; an absent id
              // belongs to a row written before audit wiring or by internal tooling.
              const actorLabel = document.createdBy
                ? (data.actors?.[document.createdBy]?.label ??
                  t('collections.history.audit.formerUser'))
                : t('collections.history.audit.unknown')
              const actionKey = document.eventType
                ? AUDIT_ACTION_KEYS[document.eventType]
                : undefined
              const actionLabel = actionKey ? t(actionKey) : (document.eventType ?? '')
              const versionLabel = new Date(document.createdAt).toLocaleString()
              const openCompare = () => {
                if (versionId == null) return
                setSelectedVersion({ versionId, label: versionLabel })
              }
              const openRestore = () => {
                if (versionId == null || versionId === currentVersionId) return
                setRestoreTarget({ versionId, label: versionLabel, versionNumber })
              }

              return (
                <Fragment key={versionId ?? document.id}>
                  <Table.Row className={cx('byline-coll-history-row', styles.historyRow)}>
                    <Table.Cell
                      className={cx('byline-coll-history-version-cell', styles.versionCell)}
                    >
                      {versionId && currentDocument ? (
                        <IconButton
                          size="xs"
                          variant="outlined"
                          intent="noeffect"
                          aria-label={t('collections.history.compareAriaLabel')}
                          title={t('collections.history.compareTitle')}
                          className={cx('byline-coll-history-version-button', styles.versionButton)}
                          onClick={openCompare}
                        >
                          {versionNumber}
                        </IconButton>
                      ) : null}
                    </Table.Cell>
                    {rowPresentation.renderCells({
                      document,
                      versionId,
                      versionNumber,
                      currentVersionId,
                      actorLabel,
                      actionLabel,
                      openCompare,
                      openRestore,
                    })}
                  </Table.Row>
                  <Table.Row
                    className={cx('byline-coll-history-audit-row', styles.auditRow)}
                    aria-label={t('collections.history.audit.createdBy', {
                      label: actorLabel,
                    })}
                  >
                    <Table.Cell
                      className={cx(
                        'byline-coll-history-audit-spacer-cell',
                        styles.auditSpacerCell
                      )}
                    />
                    <Table.Cell
                      colSpan={rowPresentation.auditColSpan}
                      className={cx('byline-coll-history-audit-cell', styles.auditCell)}
                    >
                      <span className={cx('byline-coll-history-audit', styles.audit)}>
                        {actionLabel}
                        {' · '}
                        {t('collections.history.audit.createdBy', { label: actorLabel })}
                        {' · '}
                        {versionLabel}
                      </span>
                    </Table.Cell>
                  </Table.Row>
                </Fragment>
              )
            })}
          </Table.Body>
        </Table>
        {padRows(6 - data.docs.length)}
      </Table.Container>
      <div
        className={cx(
          'byline-coll-history-options byline-coll-history-options-bottom',
          styles.options,
          styles.optionsBottom
        )}
      >
        <Select<string>
          containerClassName={cx('byline-coll-history-page-size', styles.pageSize)}
          id="page_size"
          name="page_size"
          size="sm"
          defaultValue="15"
          items={[
            { value: '15', label: '15' },
            { value: '30', label: '30' },
            { value: '50', label: '50' },
            { value: '100', label: '100' },
          ]}
          onValueChange={(value) => {
            if (typeof value !== 'string' || value.length === 0) return
            onPageSizeChange(Number.parseInt(value, 10))
          }}
        />
        <RouterPager
          smoothScrollToTop={true}
          page={data.meta.page}
          count={data.meta.totalPages}
          showFirstButton
          showLastButton
          componentName="pagerBottom"
          aria-label={t('collections.list.pagerBottomAriaLabel')}
        />
      </div>

      {selectedVersion && currentDocument && (
        <Suspense fallback={null}>
          <DiffModal
            isOpen={true}
            onDismiss={() => setSelectedVersion(null)}
            collection={resourcePath}
            documentId={documentId}
            versionId={selectedVersion.versionId}
            versionLabel={selectedVersion.label}
            currentDocument={currentDocument}
            locale={locale}
            loadHistoricalVersion={loadHistoricalVersion}
          />
        </Suspense>
      )}

      <Modal
        isOpen={restoreTarget != null}
        onDismiss={() => setRestoreTarget(null)}
        closeOnOverlayClick={false}
      >
        <Modal.Container className={cx('byline-coll-history-restore-modal', styles.restoreModal)}>
          <Modal.Header
            className={cx('byline-coll-history-restore-modal-head', styles.restoreModalHead)}
          >
            <h3 className="m-0">{t('collections.history.restoreModalTitle')}</h3>
            <IconButton
              aria-label={t('common.actions.close')}
              size="xs"
              onClick={() => setRestoreTarget(null)}
            >
              <CloseIcon width="14px" height="14px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          {restoreTarget ? (
            <RestoreVersionModal
              versionLabel={restoreTarget.label}
              versionNumber={restoreTarget.versionNumber}
              onClose={() => setRestoreTarget(null)}
              restoreVersion={() => restoreVersion(restoreTarget.versionId)}
              onRestoreComplete={onRestoreComplete}
            />
          ) : null}
        </Modal.Container>
      </Modal>
    </>
  )
}
