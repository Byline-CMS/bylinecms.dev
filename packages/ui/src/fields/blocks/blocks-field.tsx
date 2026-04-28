/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useMemo, useState } from 'react'

import type {
  BlocksField as BlocksFieldType,
  Field,
  GroupField as GroupFieldType,
} from '@byline/core'
import { Card, CloseIcon, IconButton, Modal, PlusIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import { DraggableSortable, moveItem } from '../../dnd/draggable-sortable'
import { defaultScalarForField } from '../../fields/field-helpers'
import { GroupField } from '../../fields/group/group-field'
import { SortableItem } from '../../fields/sortable-item'
import { useFormContext } from '../../forms/form-context'
import styles from './blocks-field.module.css'

// ---------------------------------------------------------------------------
// BlocksField — renders `type: 'blocks'` fields. Children are heterogeneous
// group fields selected via a modal picker. Supports D&D.
// ---------------------------------------------------------------------------

export const BlocksField = ({
  field,
  defaultValue,
  path,
}: {
  field: BlocksFieldType
  defaultValue: any
  path: string
}) => {
  const { appendPatch, getFieldValue, getFieldValues, setFieldStore } = useFormContext()
  const [items, setItems] = useState<{ id: string; data: any }[]>([])
  const [showAddBlockModal, setShowAddBlockModal] = useState(false)
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(null)

  const availableBlocks = useMemo(() => field.blocks ?? [], [field.blocks])
  const [selectedBlockName, setSelectedBlockName] = useState<string>(
    () => availableBlocks[0]?.blockType
  )

  useEffect(() => {
    if (
      selectedBlockName == null ||
      !availableBlocks.some((b) => b.blockType === selectedBlockName)
    ) {
      setSelectedBlockName(availableBlocks[0]?.blockType)
    }
  }, [availableBlocks, selectedBlockName])

  useEffect(() => {
    if (Array.isArray(defaultValue)) {
      setItems(
        defaultValue.map((item: any) => ({
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
  }, [defaultValue])

  const handleDragEnd = ({
    moveFromIndex,
    moveToIndex,
  }: {
    moveFromIndex: number
    moveToIndex: number
  }) => {
    setItems((prev) => moveItem(prev, moveFromIndex, moveToIndex))
    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]

    if (Array.isArray(currentArray)) {
      const clampedFrom = Math.max(0, Math.min(moveFromIndex, currentArray.length - 1))
      const clampedTo = Math.max(0, Math.min(moveToIndex, currentArray.length - 1))
      if (clampedFrom === clampedTo) return

      const item = currentArray[clampedFrom]
      const itemId =
        item && typeof item === 'object' && '_id' in item
          ? String((item as { _id: string })._id)
          : String(clampedFrom)

      appendPatch({
        kind: 'array.move',
        path: path,
        itemId,
        toIndex: clampedTo,
      })
    }
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
    const itemId =
      item && typeof item === 'object' && '_id' in item
        ? String((item as { _id: string })._id)
        : String(index)

    setItems((prev) => prev.filter((_, i) => i !== index))

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
    const arrayElementPath = `${path}[${index}]`

    if (!item || typeof item !== 'object' || typeof item._type !== 'string') return null

    const subField = field.blocks?.find((b) => b.blockType === item._type)
    if (subField == null) return null

    // Extract field data (everything except _id and _type)
    const { _id, _type, ...fieldData } = item
    const label = subField.label ?? _type

    // Render the block's children directly with arrayElementPath as the
    // path (not basePath).  FieldRenderer would append the group name
    // (e.g. "richTextBlock") producing paths like
    // "content[0].richTextBlock.constrainedWidth", but the flat block
    // shape stores fields directly on the item so the correct path is
    // "content[0].constrainedWidth".
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
            aria-label="Add block"
          >
            <PlusIcon />
          </IconButton>
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
        <Modal.Container style={{ maxWidth: '600px' }}>
          <Modal.Header className={cx('byline-field-blocks-modal-head', styles['modal-head'])}>
            <h3 className={cx('byline-field-blocks-modal-title', styles['modal-title'])}>Blocks</h3>
            <IconButton
              arial-label="Close"
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
