/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useState } from 'react'

import type { CollectionAdminConfig, CollectionDefinition, ColumnDefinition } from '@byline/core'
import { getCollectionAdminConfig } from '@byline/core'
import { Button, LoaderRing, Modal, Search } from '@infonomic/uikit/react'
import cx from 'classnames'

import { getCollectionDocuments } from '@/modules/admin/collections'

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
interface RelationPickerProps {
  /** The target collection path (e.g. `'media'`). */
  targetCollectionPath: string
  /** The target collection definition (used for labels + displayField fallback). */
  targetDefinition?: CollectionDefinition | null
  /** Explicit display field to render as row label. */
  displayField?: string
  /** Modal open/close state. */
  isOpen: boolean
  /** Called with the picked selection when the user confirms. */
  onSelect: (selection: { target_document_id: string; target_collection_id: string }) => void
  /** Called when the user dismisses the modal. */
  onDismiss: () => void
}

const PAGE_SIZE = 15

export const RelationPicker = ({
  targetCollectionPath,
  targetDefinition,
  displayField,
  isOpen,
  onSelect,
  onDismiss,
}: RelationPickerProps) => {
  const [query, setQuery] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<any[]>([])
  const [totalPages, setTotalPages] = useState<number>(1)
  const [collectionId, setCollectionId] = useState<string | null>(null)

  const targetAdminConfig: CollectionAdminConfig | null =
    getCollectionAdminConfig(targetCollectionPath)
  const pickerColumns = targetAdminConfig?.picker

  // Reset local state each time the modal opens so prior queries don't leak.
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setPage(1)
      setSelectedDocumentId(null)
      setError(null)
    }
  }, [isOpen])

  // Fetch whenever the modal is open and the query / page changes.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    const selectFields = resolveSelectFields(targetDefinition, displayField, pickerColumns)

    setLoading(true)
    setError(null)
    getCollectionDocuments({
      data: {
        collection: targetCollectionPath,
        params: {
          page,
          page_size: PAGE_SIZE,
          query: query.length > 0 ? query : undefined,
          fields: selectFields,
        },
      },
    })
      .then((response) => {
        if (cancelled) return
        setDocuments(response.documents)
        setTotalPages(response.meta.total_pages ?? 1)
        setCollectionId(response.included.collection.id as string)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load documents')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, targetCollectionPath, query, page, displayField, targetDefinition, pickerColumns])

  const resolvedDisplayField =
    displayField ??
    targetDefinition?.useAsTitle ??
    resolveFallbackDisplayField(targetDefinition) ??
    null

  const handleSelect = useCallback(() => {
    if (!selectedDocumentId || !collectionId) return
    onSelect({
      target_document_id: selectedDocumentId,
      target_collection_id: collectionId,
    })
  }, [selectedDocumentId, collectionId, onSelect])

  const title = targetDefinition
    ? `Select ${targetDefinition.labels.singular}`
    : `Select ${targetCollectionPath}`

  return (
    <Modal isOpen={isOpen} onDismiss={onDismiss}>
      <Modal.Container style={{ maxWidth: '600px', width: '100%' }}>
        <Modal.Header className="pt-4 mb-2">
          <h3 className="m-0 mb-2 text-xl">{title}</h3>
        </Modal.Header>
        <Modal.Content>
          <div className="flex flex-col gap-3">
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
              placeholder="Search"
            />

            <div className="min-h-[320px] max-h-[420px] overflow-y-auto border border-gray-700 rounded-md">
              {loading && documents.length === 0 && (
                <div className="flex items-center justify-center py-10">
                  <LoaderRing size={24} color="#888888" />
                </div>
              )}
              {!loading && error && (
                <div className="px-4 py-10 text-center text-sm text-red-500">{error}</div>
              )}
              {!loading && !error && documents.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-gray-400">
                  No documents found
                </div>
              )}
              {documents.length > 0 && (
                <ul className="divide-y divide-gray-700">
                  {documents.map((doc) => {
                    const id = doc.document_id as string
                    const selected = selectedDocumentId === id
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={cx(
                            'w-full text-left px-3 py-2',
                            'hover:bg-gray-800 transition-colors',
                            selected && 'bg-primary-900/30 border-l-2 border-primary-400'
                          )}
                          onClick={() => setSelectedDocumentId(id)}
                        >
                          {pickerColumns && pickerColumns.length > 0 ? (
                            <div className="flex items-center gap-3">
                              {pickerColumns.map((col) => (
                                <PickerCell key={String(col.fieldName)} column={col} record={doc} />
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm text-gray-100 truncate">
                                {resolveRowLabel(doc, resolvedDisplayField) || id}
                              </span>
                              {typeof doc.path === 'string' && doc.path.length > 0 && (
                                <span className="text-xs text-gray-500 truncate">{doc.path}</span>
                              )}
                            </div>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-400">
                <Button
                  size="xs"
                  variant="outlined"
                  intent="noeffect"
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="xs"
                  variant="outlined"
                  intent="noeffect"
                  type="button"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </Modal.Content>
        <Modal.Actions>
          <Button size="sm" intent="noeffect" type="button" onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            size="sm"
            intent="primary"
            type="button"
            disabled={!selectedDocumentId}
            onClick={handleSelect}
          >
            Select
          </Button>
        </Modal.Actions>
      </Modal.Container>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** First top-level `text` field name on a collection, or null. */
function resolveFallbackDisplayField(def: CollectionDefinition | null | undefined): string | null {
  if (!def) return null
  const textField = def.fields.find((f) => f.type === 'text')
  return textField?.name ?? null
}

/**
 * Build the `fields` projection for the picker listing. Unions:
 *   - caller-supplied `displayField`
 *   - target schema's `useAsTitle`
 *   - every `fieldName` declared in the admin config's `picker` columns
 *   - `title` (metadata fallback for rows with no explicit picker columns)
 *
 * Returns `undefined` when no target definition is available, leaving the
 * listing endpoint to decide its own default projection.
 */
function resolveSelectFields(
  def: CollectionDefinition | null | undefined,
  displayField: string | undefined,
  pickerColumns: ColumnDefinition[] | undefined
): string[] | undefined {
  if (!def) return undefined
  const out = new Set<string>()
  if (displayField) out.add(displayField)
  if (def.useAsTitle) out.add(def.useAsTitle)
  const fallback = resolveFallbackDisplayField(def)
  if (fallback) out.add(fallback)
  if (pickerColumns) {
    for (const col of pickerColumns) {
      const name = String(col.fieldName)
      // `status` / `updated_at` etc. are metadata columns on the row — only
      // include names that correspond to actual schema fields so we don't
      // request non-existent store data.
      if (def.fields.some((f) => f.name === name)) out.add(name)
    }
  }
  // Only include `title` when it's actually a declared field.
  if (def.fields.some((f) => f.name === 'title')) out.add('title')
  if (out.size === 0) return undefined
  return Array.from(out)
}

/** Resolve the row's primary label text from the document. */
function resolveRowLabel(doc: any, displayField: string | null): string | null {
  if (displayField) {
    const v = doc.fields?.[displayField]
    if (typeof v === 'string' && v.length > 0) return v
  }
  if (typeof doc.fields?.title === 'string' && doc.fields.title.length > 0) return doc.fields.title
  if (typeof doc.path === 'string' && doc.path.length > 0) return doc.path
  return null
}

/**
 * Render a single picker-row cell using a shared `ColumnDefinition`.
 *
 * - Reads the field value from `record.fields[fieldName]`, falling back to
 *   top-level metadata on the document (so status/updated_at/path all work
 *   out of the box).
 * - Honours both formatter shapes: plain function → its return value; or
 *   `{ component }` → the component is rendered.
 * - Respects `align` and `className` from the column definition.
 */
function PickerCell({ column, record }: { column: ColumnDefinition; record: Record<string, any> }) {
  const name = String(column.fieldName)
  const value = record?.fields?.[name] ?? record?.[name]

  let content: any
  if (column.formatter) {
    if (typeof column.formatter === 'function') {
      content = column.formatter(value, record)
    } else {
      const Comp = column.formatter.component
      content = <Comp value={value} record={record} />
    }
  } else if (value == null) {
    content = null
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    content = String(value)
  } else {
    content = null
  }

  return (
    <div
      className={cx(
        'min-w-0 text-sm text-gray-100 truncate',
        column.align === 'center' && 'text-center',
        column.align === 'right' && 'text-right',
        column.className
      )}
    >
      {content}
    </div>
  )
}
