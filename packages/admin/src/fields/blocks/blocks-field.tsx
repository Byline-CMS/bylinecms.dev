/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useMemo, useState } from 'react'

import type {
  BlockAdminConfig,
  BlocksField as BlocksFieldType,
  Field,
  GroupField as GroupFieldType,
} from '@byline/core'
import { getClientConfig } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import {
  Card,
  CloseIcon,
  DraggableSortable,
  IconButton,
  Modal,
  moveItem,
  PlusIcon,
} from '@byline/ui/react'
import cx from 'classnames'

import { defaultScalarForField } from '../../fields/field-helpers'
import { GroupField } from '../../fields/group/group-field'
import { SortableItem } from '../../fields/sortable-item'
import { useFormContext } from '../../forms/form-context'
import { hasExistingIdTargets } from '../../forms/nested-path'
import { moveRepeatingItems, repeatingItemId, repeatingItemPath } from '../../forms/repeating-items'
import styles from './blocks-field.module.css'

// ---------------------------------------------------------------------------
// BlocksField — renders `type: 'blocks'` fields. Children are heterogeneous
// group fields selected via a modal picker. Supports D&D.
// ---------------------------------------------------------------------------

export const BlocksField = ({
  field,
  defaultValue,
  path,
  contentLocale,
}: {
  field: BlocksFieldType
  defaultValue: any
  path: string
  /**
   * Active content locale, forwarded to each block item's fields so
   * localized widgets nested inside a block (e.g. a `localized` richText)
   * can render their locale badge.
   */
  contentLocale?: string
}) => {
  const { appendPatch, getFieldValue, getFieldValues, removePendingUploadsUnder, setFieldStore } =
    useFormContext()
  const { t } = useTranslation('byline-admin')
  const [items, setItems] = useState<{ id: string; data: any }[]>([])
  const [showAddBlockModal, setShowAddBlockModal] = useState(false)
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(null)

  const availableBlocks = useMemo(() => field.blocks ?? [], [field.blocks])

  // Site-wide per-block admin config (`ClientConfig.blockAdmin`), resolved by
  // blockType. Registry-based on purpose: blocks are cross-collection units,
  // so their admin config applies wherever the block renders — no threading
  // from the collection admin config is needed (mirrors how FieldRenderer
  // resolves the global richText editor from client config).
  const blockAdminByType = useMemo(() => {
    const map = new Map<string, BlockAdminConfig>()
    for (const entry of getClientConfig().blockAdmin ?? []) {
      map.set(entry.blockType, entry)
    }
    return map
  }, [])
  const [selectedBlockName, setSelectedBlockName] = useState<string>(
    () => availableBlocks[0]?.blockType ?? ''
  )

  useEffect(() => {
    if (
      selectedBlockName == null ||
      !availableBlocks.some((b) => b.blockType === selectedBlockName)
    ) {
      setSelectedBlockName(availableBlocks[0]?.blockType ?? '')
    }
  }, [availableBlocks, selectedBlockName])

  useEffect(() => {
    // Prefer the live form-store value over `defaultValue` when seeding the
    // rendered list. The store lives in FormProvider — above the tab layout —
    // so it survives this field unmounting/remounting as the editor switches
    // tabs; `defaultValue` is only the initial seed and is empty in create
    // mode. Re-seeding from `defaultValue` on remount would drop blocks the
    // editor had already added on an earlier visit to this tab.
    const storeValue = getFieldValue(path)
    const source = Array.isArray(storeValue) ? storeValue : defaultValue
    if (Array.isArray(source)) {
      setItems(
        source.map((item: any) => ({
          id:
            item && typeof item === 'object' && '_id' in item
              ? String((item as { _id: string })._id)
              : crypto.randomUUID(),
          data: item,
        }))
      )
    } else {
      setItems([])
    }
  }, [defaultValue, getFieldValue, path])

  const handleDragEnd = ({
    moveFromIndex,
    moveToIndex,
  }: {
    moveFromIndex: number
    moveToIndex: number
  }) => {
    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]
    if (!Array.isArray(currentArray)) return

    const move = moveRepeatingItems(currentArray, moveFromIndex, moveToIndex)
    if (move == null) return

    setItems((prev) => moveItem(prev, move.fromIndex, move.toIndex))
    setFieldStore(path, move.items)
    appendPatch({
      kind: 'array.move',
      path,
      itemId: move.itemId,
      toIndex: move.toIndex,
    })
  }

  const handleAddItem = async (forcedVariantName?: string, atIndex?: number) => {
    setShowAddBlockModal(false)
    setPendingInsertIndex(null)

    const variant =
      (forcedVariantName != null
        ? availableBlocks.find((v) => v.blockType === forcedVariantName)
        : undefined) ?? availableBlocks[0]

    if (!variant) return

    const compositeFields = (variant.fields ?? []) as Field[]

    const newId = crypto.randomUUID()
    const newItem: Record<string, any> = {
      _id: newId,
      _type: variant.blockType,
    }
    for (const f of compositeFields) {
      newItem[f.name] = await defaultScalarForField(f, getFieldValues)
    }

    if (!hasExistingIdTargets(getFieldValues(), path)) return

    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]
    const insertAt = atIndex != null ? atIndex : currentArray ? currentArray.length : 0

    const newItemWrapper = { id: newId, data: newItem }
    setItems((prev) => {
      const next = [...prev]
      next.splice(insertAt, 0, newItemWrapper)
      return next
    })

    appendPatch({
      kind: 'array.insert',
      path: path,
      index: insertAt,
      item: newItem,
    })

    const newArrayValue = currentArray ? [...currentArray] : []
    newArrayValue.splice(insertAt, 0, newItem)
    setFieldStore(path, newArrayValue)
  }

  const handleRemoveItem = (index: number) => {
    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]
    if (!Array.isArray(currentArray) || index < 0 || index >= currentArray.length) return

    const item = currentArray[index]
    const itemPath = repeatingItemPath(path, item, index)
    const itemId = repeatingItemId(item) ?? String(index)

    setItems((prev) => prev.filter((_, i) => i !== index))
    removePendingUploadsUnder(itemPath)

    appendPatch({
      kind: 'array.remove',
      path: path,
      itemId,
    })

    const newArrayValue = [...currentArray]
    newArrayValue.splice(index, 1)
    setFieldStore(path, newArrayValue)
  }

  const handleInsertBelow = (index: number, forcedVariantName?: string) => {
    if (availableBlocks.length > 1 && forcedVariantName == null) {
      setPendingInsertIndex(index + 1)
      setShowAddBlockModal(true)
    } else {
      void handleAddItem(forcedVariantName, index + 1)
    }
  }

  const renderItem = (itemWrapper: { id: string; data: any }, index: number) => {
    const item = itemWrapper.data
    const arrayElementPath = repeatingItemPath(path, item, index)

    if (!item || typeof item !== 'object' || typeof item._type !== 'string') return null

    const subField = field.blocks?.find((b) => b.blockType === item._type)
    if (subField == null) return null

    // Extract field data (everything except _id and _type)
    const { _id, _type, ...fieldData } = item
    const label = subField.label ?? _type

    // Render the block's children directly with arrayElementPath as the
    // path (not basePath).  FieldRenderer would append the group name
    // (e.g. "richTextBlock") producing paths like
    // "content[id=...].richTextBlock.constrainedWidth", but the flat block
    // shape stores fields directly on the item so the correct path is
    // "content[id=...].constrainedWidth".
    const body = (
      <GroupField
        key={subField.blockType}
        field={
          {
            type: 'group',
            name: subField.blockType,
            fields: subField.fields,
            label: undefined,
          } as GroupFieldType
        }
        defaultValue={fieldData}
        path={arrayElementPath}
        // Arrays directly inside a block are fully sortable: each
        // DraggableSortable is an independent DndContext and drag listeners
        // are grip-scoped, so the inner array's drags can't leak into the
        // block-level context (and vice versa).
        disableSorting={false}
        contentLocale={contentLocale}
        fieldAdmin={blockAdminByType.get(item._type)?.fields}
      />
    )

    return (
      <SortableItem
        key={itemWrapper.id}
        id={itemWrapper.id}
        label={label ?? subField.blockType}
        onAddBelow={() => handleInsertBelow(index)}
        onRemove={() => handleRemoveItem(index)}
      >
        {body}
      </SortableItem>
    )
  }

  return (
    <div className={`byline-field-blocks ${field.name}`}>
      {field.label && (
        <h3 className={cx('byline-field-blocks-title', styles.title)}>{field.label}</h3>
      )}
      <DraggableSortable
        ids={items.map((i) => i.id)}
        onDragEnd={handleDragEnd}
        className={cx('byline-field-blocks-stack', styles.stack)}
      >
        {items.map((item, index) => renderItem(item, index))}
        <div className={cx('byline-field-blocks-add-row', styles['add-row'])}>
          <IconButton
            onClick={() => {
              setPendingInsertIndex(null)
              setShowAddBlockModal(true)
            }}
            disabled={!selectedBlockName}
            aria-label={t('fields.blocks.addBlockAriaLabel')}
            variant="outlined"
          >
            <PlusIcon />
          </IconButton>
          {/* Text-styled button so the label is clickable too. Removed from
              the tab order (tabIndex -1) — the IconButton is the single
              keyboard/screen-reader control for this action. */}
          <button
            type="button"
            tabIndex={-1}
            disabled={!selectedBlockName}
            onClick={() => {
              setPendingInsertIndex(null)
              setShowAddBlockModal(true)
            }}
            className={cx('byline-field-blocks-add-label', styles['add-label'])}
          >
            {t('fields.blocks.addBlock')}
          </button>
        </div>
      </DraggableSortable>
      <Modal
        isOpen={showAddBlockModal}
        closeOnOverlayClick={true}
        onDismiss={() => {
          setShowAddBlockModal(false)
          setPendingInsertIndex(null)
        }}
      >
        <Modal.Container style={{ maxWidth: '700px' }}>
          <Modal.Header className={cx('byline-field-blocks-modal-head', styles['modal-head'])}>
            <h3 className={cx('byline-field-blocks-modal-title', styles['modal-title'])}>
              {t('fields.blocks.modalTitle')}
            </h3>
            <IconButton
              arial-label={t('common.actions.close')}
              size="xs"
              onClick={() => {
                setShowAddBlockModal(false)
                setPendingInsertIndex(null)
              }}
            >
              <CloseIcon width="16px" height="16px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content className={cx('byline-field-blocks-card-cursor', styles['modal-content'])}>
            <div className={cx('byline-field-blocks-grid', styles.grid)}>
              {availableBlocks.map((b, index) => (
                <Card
                  key={b.blockType}
                  hover
                  onClick={() => void handleAddItem(b.blockType, pendingInsertIndex ?? undefined)}
                  className={cx('byline-field-blocks-card', styles.card)}
                >
                  <Card.Header>
                    <div className={cx('byline-field-blocks-card-head', styles['card-head'])}>
                      <Card.Title
                        className={cx('byline-field-blocks-card-title', styles['card-title'])}
                      >
                        {b.label ?? b.blockType}
                      </Card.Title>
                      <span className={cx('byline-field-blocks-card-index', styles['card-index'])}>
                        {index + 1}
                      </span>
                    </div>
                    <code className={cx('byline-field-blocks-card-code', styles['card-code'])}>
                      {b.blockType}
                    </code>
                  </Card.Header>
                  <Card.Content>
                    <p className={cx('byline-field-blocks-card-body', styles['card-body'])}>
                      {b.helpText ?? b.label ?? b.blockType}
                    </p>
                  </Card.Content>
                </Card>
              ))}
            </div>
          </Modal.Content>
        </Modal.Container>
      </Modal>
    </div>
  )
}
