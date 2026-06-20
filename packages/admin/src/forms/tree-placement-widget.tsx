'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Label, Select } from '@byline/ui/react'
import cx from 'classnames'

import { useBylineFieldServices } from '../fields/field-services-context.js'
import styles from './tree-placement-widget.module.css'

const ROOT_VALUE = '__root__'

export interface TreePlacementWidgetProps {
  /** The collection path (`tree: true`). */
  collectionPath: string
  /** The logical id of the document being edited. */
  documentId: string
  /** The collection's `useAsTitle` field, used to label candidate parents. */
  useAsTitle?: string
}

/**
 * Sidebar widget for placing the current document within its collection's
 * single-parent document tree (the `tree: true` primitive — docs/DOCUMENT-TREE.md).
 *
 * The tree is document-grain and **unversioned**, so changes here write
 * immediately (independent of the form's content save) via the framework-neutral
 * tree services. The editor picks a parent — or **Top level** for a root — and
 * the move is persisted at once; the server enforces the cycle / same-collection
 * invariants and fires the structural-change invalidation event.
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
  const { getCollectionDocuments, getTreeAncestors, placeTreeNode, removeFromTree } =
    useBylineFieldServices()

  const [parentValue, setParentValue] = useState<string>(ROOT_VALUE)
  const [candidates, setCandidates] = useState<Array<{ value: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const treeServicesReady =
    getTreeAncestors != null && placeTreeNode != null && removeFromTree != null

  // Load candidate parents + the document's current parent on mount.
  useEffect(() => {
    if (getTreeAncestors == null) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      getCollectionDocuments({
        collection: collectionPath,
        params: { page_size: 200 },
      }),
      getTreeAncestors({ collection: collectionPath, documentId }),
    ])
      .then(([list, ancestors]) => {
        if (cancelled) return
        const options = list.docs
          .filter((doc) => doc.id !== documentId)
          .map((doc) => {
            const title = useAsTitle ? doc[useAsTitle] : undefined
            const label =
              typeof title === 'string' && title.length > 0 ? title : (doc.path ?? doc.id)
            return { value: doc.id, label }
          })
        setCandidates(options)
        // Immediate parent is the last (deepest) ancestor in the root-first chain.
        const parent = ancestors.at(-1)
        setParentValue(parent?.id ?? ROOT_VALUE)
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
  }, [collectionPath, documentId, useAsTitle, getCollectionDocuments, getTreeAncestors, t])

  const items = useMemo(
    () => [{ value: ROOT_VALUE, label: t('treeWidget.rootOption') }, ...candidates],
    [candidates, t]
  )

  const handleChange = useCallback(
    async (next: string | null) => {
      if (next == null || next === parentValue || busy || placeTreeNode == null) return
      const previous = parentValue
      setError(null)
      setBusy(true)
      setParentValue(next) // optimistic
      try {
        await placeTreeNode({
          collection: collectionPath,
          documentId,
          parentDocumentId: next === ROOT_VALUE ? null : next,
        })
      } catch {
        setParentValue(previous) // revert (e.g. cycle rejected by the server)
        setError(t('treeWidget.error'))
      } finally {
        setBusy(false)
      }
    },
    [parentValue, busy, placeTreeNode, collectionPath, documentId, t]
  )

  const handleRemove = useCallback(async () => {
    if (busy || removeFromTree == null) return
    setError(null)
    setBusy(true)
    try {
      await removeFromTree({ collection: collectionPath, documentId })
      setParentValue(ROOT_VALUE)
    } catch {
      setError(t('treeWidget.error'))
    } finally {
      setBusy(false)
    }
  }, [busy, removeFromTree, collectionPath, documentId, t])

  // Nothing to render when the host hasn't wired the tree services.
  if (!treeServicesReady) return null

  return (
    <div className={cx('byline-form-tree', styles.tree)}>
      <Label id="tree-placement-label" htmlFor="tree-placement" label={t('treeWidget.label')} />
      <Select<string>
        id="tree-placement"
        size="sm"
        ariaLabel={t('treeWidget.label')}
        value={parentValue}
        items={items}
        onValueChange={handleChange}
        disabled={loading || busy}
        helpText={error ?? undefined}
        intent={error ? 'danger' : undefined}
      />
      {parentValue !== ROOT_VALUE && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          className={cx('byline-form-tree-remove', styles.remove)}
        >
          {t('treeWidget.remove')}
        </button>
      )}
      <span id="tree-placement-description" className={styles['sr-only']}>
        {t('treeWidget.srDescription')}
      </span>
    </div>
  )
}
