/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useState } from 'react'

import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import { getCollectionAdminConfig, resolveItemViewColumns } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, CheckIcon, LoaderRing, Modal, Search } from '@byline/ui/react'
import cx from 'classnames'

import { useBylineFieldServices } from '../field-services-context'
import {
  PickerCell,
  resolveFallbackDisplayField,
  resolveRowLabel,
  resolveSelectFields,
} from './relation-display'
import styles from './relation-picker.module.css'

// ---------------------------------------------------------------------------
// RelationPicker — modal listing for selecting a target document
// ---------------------------------------------------------------------------

/**
 * Row rendering strategy, in priority order:
 *   1. `CollectionAdminConfig.picker` — a ColumnDefinition[] from the target
 *      admin config. Each row renders the declared columns side-by-side,
 *      reusing any column formatters (thumbnail, date, etc).
 *   2. Explicit `displayField` prop on this component (forwarded from
 *      `RelationField.displayField`).
 *   3. `CollectionDefinition.useAsTitle` on the target.
 *   4. First top-level `text` field on the target.
 *
 * Paths 2–4 render a single-line label (primary) + `path` (secondary).
 */
/**
 * One confirmed pick. `record` is the raw document the picker row rendered —
 * the caller can use it to show the selected value in its own tile without a
 * refetch. The fields available on `record` are whatever `resolveSelectFields`
 * asked the listing endpoint for (picker columns + `useAsTitle` +
 * `displayField`), so any display surface downstream of the picker that also
 * renders from those same columns will find the data it needs.
 */
export interface RelationPickerSelection {
  targetDocumentId: string
  targetCollectionId: string
  record?: Record<string, any>
}

interface RelationPickerBaseProps {
  /** The target collection path (e.g. `'media'`). */
  targetCollectionPath: string
  /** The target collection definition (used for labels + displayField fallback). */
  targetDefinition?: CollectionDefinition | null
  /** Explicit display field to render as row label. */
  displayField?: string
  /**
   * Extra field names to load into each row's `record.fields` beyond the
   * display columns. Not rendered — available to the `onSelect` consumer
   * (e.g. the inline-image modal seeding alt-text from the picked media).
   *
   * Pass a stable (module-level) array — this feeds the fetch effect's
   * dependency list, so a fresh array each render would refetch on every
   * render.
   */
  extraSelectFields?: string[]
  /** Modal open/close state. */
  isOpen: boolean
  /** Called when the user dismisses the modal. */
  onDismiss: () => void
}

interface RelationPickerSingleProps extends RelationPickerBaseProps {
  /** Single-select (default): clicking a row selects it; confirm returns one pick. */
  multiple?: false
  /** Called with the picked selection when the user confirms. */
  onSelect: (selection: RelationPickerSelection) => void
  onSelectMany?: never
  excludeIds?: never
}

interface RelationPickerMultiProps extends RelationPickerBaseProps {
  /**
   * Multi-select mode (`hasMany` widgets): rows toggle a check state and the
   * confirm action returns every selection in pick order — several picks in
   * one trip instead of reopening the modal per item.
   */
  multiple: true
  /** Called with the full selection set (pick order) when the user confirms. */
  onSelectMany: (selections: RelationPickerSelection[]) => void
  onSelect?: never
  /**
   * Target ids already present on the caller's value. Rendered as disabled
   * "already added" rows so the same target can't be picked twice.
   */
  excludeIds?: string[]
}

type RelationPickerProps = RelationPickerSingleProps | RelationPickerMultiProps

const PAGE_SIZE = 15

export const RelationPicker = ({
  targetCollectionPath,
  targetDefinition,
  displayField,
  extraSelectFields,
  isOpen,
  multiple = false,
  excludeIds,
  onSelect,
  onSelectMany,
  onDismiss,
}: RelationPickerProps) => {
  const [query, setQuery] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const { t } = useTranslation('byline-admin')
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  // Multi-select state. A Map keyed by target id preserves pick order (the
  // confirmed batch appends in that order) and carries each row's record so
  // picks survive page/search changes that swap out `documents`.
  const [selectedMap, setSelectedMap] = useState<Map<string, Record<string, any> | undefined>>(
    () => new Map()
  )
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<any[]>([])
  const [totalPages, setTotalPages] = useState<number>(1)
  const [collectionId, setCollectionId] = useState<string | null>(null)

  const { getCollectionDocuments } = useBylineFieldServices()

  const targetAdminConfig: CollectionAdminConfig | null =
    getCollectionAdminConfig(targetCollectionPath)
  const pickerColumns = resolveItemViewColumns(targetAdminConfig)

  // Reset local state each time the modal opens so prior queries don't leak.
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setPage(1)
      setSelectedDocumentId(null)
      setSelectedMap(new Map())
      setError(null)
    }
  }, [isOpen])

  // Fetch whenever the modal is open and the query / page changes.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    const selectFields = resolveSelectFields(
      targetDefinition,
      displayField,
      pickerColumns,
      extraSelectFields
    )

    setLoading(true)
    setError(null)
    // Item-view sort: the target collection's `itemViewSort` (boot-validated)
    // orders the picker independently of its list view's `defaultSort`.
    // Passed as explicit params because the list server fn gives an explicit
    // `order` top precedence; when absent the server falls back through
    // `defaultSort` → `created_at desc` (or `order_key asc` for orderable
    // collections) exactly as before.
    const itemViewSort = targetAdminConfig?.itemViewSort
    getCollectionDocuments({
      collection: targetCollectionPath,
      params: {
        page,
        page_size: PAGE_SIZE,
        query: query.length > 0 ? query : undefined,
        fields: selectFields,
        ...(itemViewSort != null
          ? { order: String(itemViewSort.field), desc: itemViewSort.direction === 'desc' }
          : {}),
      },
    })
      .then((response: any) => {
        if (cancelled) return
        setDocuments(response.docs)
        setTotalPages(response.meta.totalPages ?? 1)
        setCollectionId(response.included.collection.id as string)
      })
      .catch((err: any) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('fields.relation.picker.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    isOpen,
    targetCollectionPath,
    query,
    page,
    displayField,
    extraSelectFields,
    targetDefinition,
    pickerColumns,
    getCollectionDocuments,
    t,
    targetAdminConfig?.itemViewSort,
  ])

  const resolvedDisplayField =
    displayField ??
    targetDefinition?.useAsTitle ??
    resolveFallbackDisplayField(targetDefinition) ??
    null

  const handleSelect = useCallback(() => {
    if (!selectedDocumentId || !collectionId || !onSelect) return
    const record = documents.find((d) => d?.id === selectedDocumentId)
    onSelect({
      targetDocumentId: selectedDocumentId,
      targetCollectionId: collectionId,
      record,
    })
  }, [selectedDocumentId, collectionId, documents, onSelect])

  const handleSelectMany = useCallback(() => {
    if (selectedMap.size === 0 || !collectionId || !onSelectMany) return
    onSelectMany(
      Array.from(selectedMap, ([targetDocumentId, record]) => ({
        targetDocumentId,
        targetCollectionId: collectionId,
        record,
      }))
    )
  }, [selectedMap, collectionId, onSelectMany])

  const toggleSelected = useCallback((doc: Record<string, any>) => {
    const id = doc.id as string
    setSelectedMap((prev) => {
      const next = new Map(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.set(id, doc)
      }
      return next
    })
  }, [])

  const title = t('fields.relation.selectPickerTitle', {
    label: targetDefinition?.labels.singular ?? targetCollectionPath,
  })

  return (
    <Modal isOpen={isOpen} onDismiss={onDismiss}>
      <Modal.Container style={{ maxWidth: '600px', width: '100%' }}>
        <Modal.Header className={cx('byline-field-relation-picker-header', styles.header)}>
          <h3 className={cx('byline-field-relation-picker-title', styles.title)}>{title}</h3>
        </Modal.Header>
        <Modal.Content>
          <div className={cx('byline-field-relation-picker-body', styles.body)}>
            <Search
              onSearch={(q) => {
                setPage(1)
                setQuery(q ?? '')
              }}
              onClear={() => {
                setPage(1)
                setQuery('')
              }}
              inputSize="sm"
              placeholder={t('fields.relation.picker.searchPlaceholder')}
            />

            <div className={cx('byline-field-relation-picker-list', styles.list)}>
              {loading && documents.length === 0 && (
                <div className={cx('byline-field-relation-picker-loading', styles.loading)}>
                  <LoaderRing size={24} color="#888888" />
                </div>
              )}
              {!loading && error && (
                <div className={cx('byline-field-relation-picker-error', styles.error)}>
                  {error}
                </div>
              )}
              {!loading && !error && documents.length === 0 && (
                <div className={cx('byline-field-relation-picker-empty', styles.empty)}>
                  {t('fields.relation.picker.empty')}
                </div>
              )}
              {documents.length > 0 && (
                <ul className={cx('byline-field-relation-picker-rows', styles.rows)}>
                  {documents.map((doc) => {
                    const id = doc.id as string
                    const selected = multiple ? selectedMap.has(id) : selectedDocumentId === id
                    const excluded = multiple && (excludeIds?.includes(id) ?? false)
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          disabled={excluded}
                          aria-pressed={multiple ? selected : undefined}
                          title={excluded ? t('fields.relation.picker.alreadyAdded') : undefined}
                          className={cx(
                            'byline-field-relation-picker-row-button',
                            styles['row-button'],
                            multiple && [
                              'byline-field-relation-picker-row-multi',
                              styles['row-multi'],
                            ],
                            selected && [
                              'byline-field-relation-picker-row-selected',
                              styles['row-selected'],
                            ],
                            excluded && [
                              'byline-field-relation-picker-row-added',
                              styles['row-added'],
                            ]
                          )}
                          onClick={() => {
                            if (excluded) return
                            if (multiple) {
                              toggleSelected(doc)
                            } else {
                              setSelectedDocumentId(id)
                            }
                          }}
                        >
                          {multiple && (
                            <span
                              aria-hidden="true"
                              className={cx(
                                'byline-field-relation-picker-check',
                                styles.check,
                                (selected || excluded) && [
                                  'byline-field-relation-picker-check-checked',
                                  styles['check-checked'],
                                ]
                              )}
                            >
                              {(selected || excluded) && <CheckIcon width="12px" height="12px" />}
                            </span>
                          )}
                          {pickerColumns && pickerColumns.length > 0 ? (
                            <div
                              className={cx(
                                'byline-field-relation-picker-row-cells',
                                styles['row-cells']
                              )}
                            >
                              {pickerColumns.map((col) => (
                                <PickerCell key={String(col.fieldName)} column={col} record={doc} />
                              ))}
                            </div>
                          ) : (
                            <div
                              className={cx(
                                'byline-field-relation-picker-row-stack',
                                styles['row-stack']
                              )}
                            >
                              <span
                                className={cx(
                                  'byline-field-relation-picker-row-label',
                                  styles['row-label']
                                )}
                              >
                                {resolveRowLabel(doc, resolvedDisplayField) || id}
                              </span>
                              {typeof doc.path === 'string' && doc.path.length > 0 && (
                                <span
                                  className={cx(
                                    'byline-field-relation-picker-row-path',
                                    styles['row-path']
                                  )}
                                >
                                  {doc.path}
                                </span>
                              )}
                            </div>
                          )}
                          {excluded && (
                            <span
                              className={cx(
                                'byline-field-relation-picker-added-hint',
                                styles['added-hint']
                              )}
                            >
                              {t('fields.relation.picker.alreadyAdded')}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {totalPages > 1 && (
              <div className={cx('byline-field-relation-picker-pager', styles.pager)}>
                <Button
                  size="xs"
                  variant="outlined"
                  intent="noeffect"
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('common.pager.previous')}
                </Button>
                <span>{t('common.pager.pageOf', { page, total: totalPages })}</span>
                <Button
                  size="xs"
                  variant="outlined"
                  intent="noeffect"
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('common.pager.next')}
                </Button>
              </div>
            )}
          </div>
        </Modal.Content>
        <Modal.Actions>
          <Button
            size="sm"
            intent="noeffect"
            type="button"
            onClick={onDismiss}
            className={cx('byline-field-relation-picker-action', styles.action)}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            size="sm"
            className={cx('byline-field-relation-picker-action', styles.action)}
            intent="primary"
            type="button"
            disabled={multiple ? selectedMap.size === 0 : !selectedDocumentId}
            onClick={multiple ? handleSelectMany : handleSelect}
          >
            {multiple
              ? t('fields.relation.picker.addSelected', { count: selectedMap.size })
              : t('common.actions.select')}
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}
