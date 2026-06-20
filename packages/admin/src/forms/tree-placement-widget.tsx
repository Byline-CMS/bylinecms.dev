'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useState } from 'react'

import { getCollectionDefinition } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button } from '@byline/ui/react'
import cx from 'classnames'

import { useBylineFieldServices } from '../fields/field-services-context.js'
import { RelationPicker } from '../fields/relation/relation-picker.js'
import styles from './tree-placement-widget.module.css'

export interface TreePlacementWidgetProps {
  /** The collection path (`tree: true`). */
  collectionPath: string
  /** The logical id of the document being edited. */
  documentId: string
  /** The collection's `useAsTitle` field, used to label the chosen parent. */
  useAsTitle?: string
}

/**
 * Sidebar widget for placing the current document within its collection's
 * single-parent document tree (the `tree: true` primitive — docs/DOCUMENT-TREE.md).
 *
 * The tree is document-grain and **unversioned**, so changes here write
 * immediately (independent of the form's content save). The editor picks a
 * parent through the collection's own relation picker — same search / columns
 * UX as a relation field — or moves the document to the top level; the server
 * enforces the cycle / same-collection invariants and fires the
 * structural-change invalidation event.
 *
 * Renders only in edit mode (placement needs a persisted document) and only when
 * the host wires the tree services. Stable override handle: `.byline-form-tree`.
 */
export const TreePlacementWidget = ({
  collectionPath,
  documentId,
  useAsTitle,
}: TreePlacementWidgetProps) => {
  const { t } = useTranslation('byline-admin')
  const { getTreeAncestors, placeTreeNode, removeFromTree } = useBylineFieldServices()
  const targetDefinition = getCollectionDefinition(collectionPath)

  const [parent, setParent] = useState<{ id: string; title: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const treeServicesReady =
    getTreeAncestors != null && placeTreeNode != null && removeFromTree != null

  // Load the document's current parent (the deepest ancestor) on mount.
  useEffect(() => {
    if (getTreeAncestors == null) return
    let cancelled = false
    setLoading(true)
    getTreeAncestors({ collection: collectionPath, documentId })
      .then((ancestors) => {
        if (cancelled) return
        const immediate = ancestors.at(-1)
        setParent(immediate ? { id: immediate.id, title: immediate.title } : null)
      })
      .catch(() => {
        if (!cancelled) setError(t('treeWidget.error'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [getTreeAncestors, collectionPath, documentId, t])

  // Place (or re-parent) the node, optimistically updating the current-parent
  // display and reverting on a server rejection (e.g. a cycle).
  const place = useCallback(
    async (parentDocumentId: string | null, optimistic: { id: string; title: string } | null) => {
      if (placeTreeNode == null || busy) return
      const previous = parent
      setError(null)
      setBusy(true)
      setParent(optimistic)
      try {
        await placeTreeNode({ collection: collectionPath, documentId, parentDocumentId })
      } catch {
        setParent(previous)
        setError(t('treeWidget.error'))
      } finally {
        setBusy(false)
      }
    },
    [placeTreeNode, busy, parent, collectionPath, documentId, t]
  )

  const handlePick = useCallback(
    (selection: { targetDocumentId: string; record?: Record<string, any> }) => {
      setPickerOpen(false)
      const title = useAsTitle ? selection.record?.[useAsTitle] : undefined
      place(selection.targetDocumentId, {
        id: selection.targetDocumentId,
        title: typeof title === 'string' && title.length > 0 ? title : selection.targetDocumentId,
      })
    },
    [place, useAsTitle]
  )

  const handleRemove = useCallback(async () => {
    if (removeFromTree == null || busy) return
    const previous = parent
    setError(null)
    setBusy(true)
    setParent(null)
    try {
      await removeFromTree({ collection: collectionPath, documentId })
    } catch {
      setParent(previous)
      setError(t('treeWidget.error'))
    } finally {
      setBusy(false)
    }
  }, [removeFromTree, busy, parent, collectionPath, documentId, t])

  if (!treeServicesReady) return null

  return (
    <div className={cx('byline-form-tree', styles.tree)}>
      <span className={cx('byline-form-tree-heading', styles.heading)}>
        {t('treeWidget.label')}
      </span>

      <div className={cx('byline-form-tree-current', styles.current)}>
        <span className={styles.parentLabel}>{t('treeWidget.parentPrefix')}</span>{' '}
        {parent ? (
          <span className={styles.parentValue}>{parent.title}</span>
        ) : (
          <span className={cx(styles.parentValue, styles.root)}>{t('treeWidget.rootOption')}</span>
        )}
      </div>

      <div className={cx('byline-form-tree-actions', styles.actions)}>
        <Button
          type="button"
          size="xs"
          variant="outlined"
          intent="noeffect"
          disabled={loading || busy}
          onClick={() => setPickerOpen(true)}
        >
          {t('treeWidget.choose')}
        </Button>
        {parent != null && (
          <button
            type="button"
            className={cx('byline-form-tree-link', styles.link)}
            disabled={busy}
            onClick={() => place(null, null)}
          >
            {t('treeWidget.makeRoot')}
          </button>
        )}
        <button
          type="button"
          className={cx('byline-form-tree-link', styles.link)}
          disabled={busy}
          onClick={handleRemove}
        >
          {t('treeWidget.remove')}
        </button>
      </div>

      {error != null && <p className={cx('byline-form-tree-error', styles.error)}>{error}</p>}

      {targetDefinition != null && (
        <RelationPicker
          targetCollectionPath={collectionPath}
          targetDefinition={targetDefinition}
          displayField={useAsTitle}
          isOpen={pickerOpen}
          onSelect={handlePick}
          onDismiss={() => setPickerOpen(false)}
        />
      )}

      <span className={styles['sr-only']}>{t('treeWidget.srDescription')}</span>
    </div>
  )
}
