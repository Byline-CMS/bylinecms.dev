/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Fragment, lazy, Suspense, useState } from 'react'
import { useParams, useRouterState } from '@tanstack/react-router'

import { renderFormatted, StatusBadge } from '@byline/admin/react'
import { useBylineAdminServices } from '@byline/admin/services'
import type { CollectionAdminConfig, CollectionDefinition, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { useTranslation } from '@byline/i18n/react'
import {
  Button,
  CloseIcon,
  Container,
  IconButton,
  Modal,
  Section,
  Select,
  Table,
} from '@byline/ui/react'
import cx from 'classnames'

import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './history.module.css'
import { RestoreVersionModal } from './restore-version-modal.js'
import { ViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from './view-menu.js'

/**
 * Resolve a column value from a document, checking `fields` first (user-defined
 * collection fields) then the root (metadata like status, updated_at).
 */
function getColumnValue(document: any, fieldName: string): any {
  if (document.fields && fieldName in document.fields) {
    return document.fields[fieldName]
  }
  return document[fieldName]
}

// Lazy-load DiffModal because react-diff-viewer-continued uses a web worker
// bundle that cannot be resolved by Node during SSR.
const DiffModal = lazy(() => import('@byline/admin/react').then((m) => ({ default: m.DiffModal })))

/**
 * Safely extract a displayable string from a field value that may be a plain
 * string or a locale-keyed object (when locale='all').
 * Falls back to the supplied default content locale, then the first available value.
 */
function resolveDisplayValue(
  value: unknown,
  locale: string | undefined,
  defaultContentLocale: string
): string {
  if (value == null) return ''
  if (typeof value === 'object' && !Array.isArray(value)) {
    const map = value as Record<string, unknown>
    const candidate =
      locale && locale !== 'all'
        ? map[locale]
        : (map[defaultContentLocale] ?? Object.values(map)[0])
    return candidate != null ? String(candidate) : ''
  }
  return String(value)
}

function Stats({ total }: { total: number }) {
  return (
    <span className={cx('byline-coll-history-stats', styles.stats)}>
      {formatNumber(total as number, 0)}
    </span>
  )
}

function padRows(value: number) {
  return Array.from({ length: value }).map((_, index) => (
    <div
      key={`empty-row-${
        // biome-ignore lint/suspicious/noArrayIndexKey: we're okay here
        index
      }`}
      className={cx('byline-coll-history-pad-row', styles.padRow)}
    >
      &nbsp;
    </div>
  ))
}

/**
 * Maps `event_type` values to audit-strip action labels. Unknown event
 * types fall back to the raw value rather than a missing-key warning.
 */
const AUDIT_ACTION_KEYS: Record<string, string> = {
  create: 'collections.history.audit.actionCreate',
  update: 'collections.history.audit.actionUpdate',
  restore: 'collections.history.audit.actionRestore',
  copy_to_locale: 'collections.history.audit.actionCopyToLocale',
  delete_locale: 'collections.history.audit.actionDeleteLocale',
}

export const HistoryView = ({
  collectionDefinition,
  adminConfig,
  data,
  workflowStatuses,
  currentDocument,
  contentLocales,
  defaultContentLocale,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  data: AnyCollectionSchemaTypes['HistoryType'] & {
    /**
     * Version-attribution display labels, resolved admin-side from each
     * version's `createdBy` id (see docs/AUDIT.md — Workstream 1). Ids
     * absent from the map belong to deleted users.
     */
    actors?: Record<string, { label: string }>
  }
  workflowStatuses?: WorkflowStatus[]
  currentDocument?: Record<string, unknown> | null
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const { id, collection } = useParams({
    from: '/_byline/admin/collections/$collection/$id/history',
  })
  const navigate = useNavigate()
  const { getCollectionDocumentVersion } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const columns = adminConfig?.columns || []
  const { labels } = collectionDefinition
  // The identity column — drives the clickable compare cell and the
  // injected restore column, mirroring list.tsx. `useAsTitle` is optional;
  // when absent, those affordances (and the strip colspan's +1) turn off.
  const titleFieldName = collectionDefinition.useAsTitle
  const location = useRouterState({ select: (s) => s.location })
  const locale = (location.search as { locale?: string }).locale
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
      ? (currentDocument.versionId as string)
      : null

  function handleOnPageSizeChange(value: string | null): void {
    if (typeof value !== 'string' || value.length === 0) return
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = Number.parseInt(value, 10)
    navigate({
      to: '/admin/collections/$collection/$id/history' as never,
      params: { collection, id } as never,
      search: params,
    })
  }

  return (
    <>
      <Section>
        <Container>
          <div className={cx('byline-coll-history-head', styles.head)}>
            <h2 className={cx('byline-coll-history-title', styles.title)}>
              {t('collections.history.title', { label: labels.singular })}{' '}
              <Stats total={data?.meta.total} />
            </h2>
            <ViewMenu
              collection={collection}
              documentId={id}
              activeView="history"
              locale={locale}
              contentLocales={contentLocales}
              defaultContentLocale={defaultContentLocale}
            />
          </div>
        </Container>
      </Section>
      <Section>
        <Container>
          <div className={cx('byline-coll-history-options', styles.options)}>
            <RouterPager
              page={data?.meta.page}
              count={data?.meta.totalPages}
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
                  {columns.flatMap((column) => {
                    const cell = (
                      <TableHeadingCellSortable
                        key={String(column.fieldName)}
                        fieldName={String(column.fieldName)}
                        label={column.label}
                        sortable={column.sortable}
                        scope="col"
                        align={column.align}
                        className={column.className}
                      />
                    )
                    if (titleFieldName != null && column.fieldName === titleFieldName) {
                      return [
                        cell,
                        <th
                          key="__restore"
                          scope="col"
                          className={cx('byline-coll-history-col-restore', styles.colRestore)}
                        />,
                      ]
                    }
                    return [cell]
                  })}
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {data?.docs?.map((document, rowIndex) => {
                  const versionId = document.versionId
                  const { total, page, pageSize, desc } = data.meta
                  const versionNumber = desc
                    ? total - (page - 1) * pageSize - rowIndex
                    : (page - 1) * pageSize + rowIndex + 1
                  // Audit strip (docs/AUDIT.md — W1): who created this
                  // version, via which action. A present-but-unresolved id
                  // is a deleted user; an absent id is a pre-attribution
                  // row or an internal-tooling write.
                  const actorLabel = document.createdBy
                    ? (data.actors?.[document.createdBy]?.label ??
                      t('collections.history.audit.formerUser'))
                    : t('collections.history.audit.unknown')
                  const actionKey = document.eventType
                    ? AUDIT_ACTION_KEYS[document.eventType]
                    : undefined
                  const actionLabel = actionKey ? t(actionKey) : (document.eventType ?? '')
                  // The strip starts on the second column — an empty spacer
                  // cell sits under the version-number column, then one cell
                  // spans the data columns plus the restore cell appended
                  // after the identity column when present.
                  const auditColSpan =
                    columns.length +
                    (titleFieldName != null && columns.some((c) => c.fieldName === titleFieldName)
                      ? 1
                      : 0)
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
                              className={cx(
                                'byline-coll-history-version-button',
                                styles.versionButton
                              )}
                              onClick={() =>
                                setSelectedVersion({
                                  versionId,
                                  label: new Date(document.createdAt).toLocaleString(),
                                })
                              }
                            >
                              {versionNumber}
                            </IconButton>
                          ) : null}
                        </Table.Cell>
                        {columns.flatMap((column) => {
                          const dataCell = (
                            <Table.Cell
                              key={String(column.fieldName)}
                              className={cx({
                                'byline-coll-history-cell-right': column.align === 'right',
                                [styles.cellRight]: column.align === 'right',
                                'byline-coll-history-cell-center': column.align === 'center',
                                [styles.cellCenter]: column.align === 'center',
                              })}
                            >
                              {titleFieldName != null && column.fieldName === titleFieldName ? (
                                versionId && currentDocument ? (
                                  <button
                                    type="button"
                                    className={cx(
                                      'byline-coll-history-title-button',
                                      styles.titleButton
                                    )}
                                    onClick={() =>
                                      setSelectedVersion({
                                        versionId,
                                        label: new Date(document.createdAt).toLocaleString(),
                                      })
                                    }
                                  >
                                    {column.formatter
                                      ? renderFormatted(
                                          getColumnValue(document, column.fieldName as string),
                                          document,
                                          column.formatter
                                        )
                                      : resolveDisplayValue(
                                          getColumnValue(document, column.fieldName as string),
                                          locale,
                                          defaultContentLocale
                                        ) || '------'}
                                  </button>
                                ) : (
                                  <Link
                                    to={'/admin/collections/$collection/$id' as never}
                                    params={{
                                      collection,
                                      id: document.id,
                                    }}
                                  >
                                    {column.formatter
                                      ? renderFormatted(
                                          getColumnValue(document, column.fieldName as string),
                                          document,
                                          column.formatter
                                        )
                                      : resolveDisplayValue(
                                          getColumnValue(document, column.fieldName as string),
                                          locale,
                                          defaultContentLocale
                                        ) || '------'}
                                  </Link>
                                )
                              ) : column.formatter ? (
                                renderFormatted(
                                  getColumnValue(document, column.fieldName as string),
                                  document,
                                  column.formatter
                                )
                              ) : column.fieldName === 'status' && workflowStatuses ? (
                                <StatusBadge
                                  status={document.status}
                                  workflowStatuses={workflowStatuses}
                                />
                              ) : (
                                resolveDisplayValue(
                                  getColumnValue(document, column.fieldName as string),
                                  locale,
                                  defaultContentLocale
                                ) || ''
                              )}
                            </Table.Cell>
                          )
                          if (titleFieldName != null && column.fieldName === titleFieldName) {
                            return [
                              dataCell,
                              <Table.Cell
                                key="__restore"
                                className={cx(
                                  'byline-coll-history-restore-cell',
                                  styles.restoreCell
                                )}
                              >
                                {versionId && versionId !== currentVersionId ? (
                                  <Button
                                    type="button"
                                    variant="outlined"
                                    size="xs"
                                    intent="noeffect"
                                    onClick={() =>
                                      setRestoreTarget({
                                        versionId,
                                        label: new Date(document.createdAt).toLocaleString(),
                                        versionNumber,
                                      })
                                    }
                                    className={cx(
                                      'byline-coll-history-restore-button',
                                      styles.restoreButton
                                    )}
                                    title={t('collections.history.restoreButtonTitle')}
                                  >
                                    {t('collections.history.restoreButton')}
                                  </Button>
                                ) : null}
                              </Table.Cell>,
                            ]
                          }
                          return [dataCell]
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
                          colSpan={auditColSpan}
                          className={cx('byline-coll-history-audit-cell', styles.auditCell)}
                        >
                          <span className={cx('byline-coll-history-audit', styles.audit)}>
                            {actionLabel}
                            {' · '}
                            {t('collections.history.audit.createdBy', { label: actorLabel })}
                            {' · '}
                            {new Date(document.createdAt).toLocaleString()}
                          </span>
                        </Table.Cell>
                      </Table.Row>
                    </Fragment>
                  )
                })}
              </Table.Body>
            </Table>
            {padRows(6 - (data?.docs?.length ?? 0))}
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
              onValueChange={handleOnPageSizeChange}
            />
            <RouterPager
              smoothScrollToTop={true}
              page={data?.meta.page}
              count={data?.meta.totalPages}
              showFirstButton
              showLastButton
              componentName="pagerBottom"
              aria-label={t('collections.list.pagerBottomAriaLabel')}
            />
          </div>
        </Container>
      </Section>

      {selectedVersion && currentDocument && (
        <Suspense fallback={null}>
          <DiffModal
            isOpen={true}
            onDismiss={() => setSelectedVersion(null)}
            collection={collection}
            documentId={id}
            versionId={selectedVersion.versionId}
            versionLabel={selectedVersion.label}
            currentDocument={currentDocument}
            locale={locale}
            loadHistoricalVersion={getCollectionDocumentVersion}
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
              collection={collection}
              documentId={id}
              versionId={restoreTarget.versionId}
              versionLabel={restoreTarget.label}
              versionNumber={restoreTarget.versionNumber}
              onClose={() => setRestoreTarget(null)}
            />
          ) : null}
        </Modal.Container>
      </Modal>
    </>
  )
}
