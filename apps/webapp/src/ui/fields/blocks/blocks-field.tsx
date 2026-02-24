/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react'

import type { BlocksField as BlocksFieldType, Field } from '@byline/core'
import { Card, CloseIcon, IconButton, Modal, PlusIcon } from '@infonomic/uikit/react'

import { DraggableSortable, moveItem } from '@/ui/dnd/draggable-sortable'
import { defaultScalarForField } from '@/ui/fields/field-helpers'
import { FieldRenderer } from '@/ui/fields/field-renderer'
import { useFormContext } from '@/ui/fields/form-context'
import { SortableItem } from '@/ui/fields/sortable-item'

// ---------------------------------------------------------------------------
// BlocksField — renders `type: 'blocks'` fields. Children are heterogeneous
// composites selected via a modal picker. Supports D&D.
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

  const compositeVariants = useMemo(
    () => (field.fields ?? []).filter((subField) => subField.type === 'composite'),
    [field.fields]
  )
  const [selectedBlockName, setSelectedBlockName] = useState<string>(
    () => compositeVariants[0]?.name
  )

  useEffect(() => {
    if (selectedBlockName == null || !compositeVariants.some((b) => b.name === selectedBlockName)) {
      setSelectedBlockName(compositeVariants[0]?.name)
    }
  }, [compositeVariants, selectedBlockName])

  useEffect(() => {
    if (Array.isArray(defaultValue)) {
      setItems(
        defaultValue.map((item: any) => ({
          id:
            item && typeof item === 'object' && 'id' in item
              ? String((item as { id: string }).id)
              : item && typeof item === 'object' && '_id' in item
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
        item && typeof item === 'object' && 'id' in item
          ? String((item as { id: string }).id)
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
        ? compositeVariants.find((v) => v.name === forcedVariantName)
        : undefined) ?? compositeVariants[0]

    if (!variant || variant.type !== 'composite') return

    const compositeFields = (variant.fields ?? []) as Field[]
    const fields = await Promise.all(
      compositeFields.map(async (f) => ({
        [f.name]: await defaultScalarForField(f, getFieldValues),
      }))
    )

    const newId = crypto.randomUUID()
    const newItem = {
      id: newId,
      type: 'composite',
      name: variant.name,
      fields,
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
      item && typeof item === 'object' && 'id' in item
        ? String((item as { id: string }).id)
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
    if (compositeVariants.length > 1 && forcedVariantName == null) {
      setPendingInsertIndex(index + 1)
      setShowAddBlockModal(true)
    } else {
      void handleAddItem(forcedVariantName, index + 1)
    }
  }

  const renderItem = (itemWrapper: { id: string; data: any }, index: number) => {
    const item = itemWrapper.data
    const arrayElementPath = `${path}[${index}]`

    let subField: Field | undefined
    let initial: any
    let label: ReactNode | undefined

    // Composite shape: { id, type: 'composite', name, fields }
    if (
      item &&
      typeof item === 'object' &&
      item.type === 'composite' &&
      typeof item.name === 'string'
    ) {
      subField = field.fields?.find((f) => f.name === item.name)
      initial = item.fields
      label = subField?.label ?? item.name
    } else if (item && typeof item === 'object') {
      // Legacy shape: { blockName: [ { fieldName: value }, ... ] }
      const outerKey = Object.keys(item).find((k) => k !== '_id')
      if (outerKey == null) return null
      subField = field.fields?.find((f) => f.name === outerKey)
      initial = item[subField?.name ?? outerKey]
      label = subField?.label ?? outerKey
    }

    if (subField == null) return null

    const body = (
      <FieldRenderer
        key={subField.name}
        field={subField}
        defaultValue={initial}
        basePath={arrayElementPath}
        disableSorting={true}
        hideLabel={true}
      />
    )

    return (
      <SortableItem
        key={itemWrapper.id}
        id={itemWrapper.id}
        label={label ?? subField.name}
        onAddBelow={() => handleInsertBelow(index)}
        onRemove={() => handleRemoveItem(index)}
      >
        {body}
      </SortableItem>
    )
  }

  return (
    <div className="">
      {field.label && <h3 className="text-[1rem] font-medium mb-1">{field.label}</h3>}
      <DraggableSortable
        ids={items.map((i) => i.id)}
        onDragEnd={handleDragEnd}
        className="flex flex-col gap-4"
      >
        {items.map((item, index) => renderItem(item, index))}
        <div className="flex items-center gap-2">
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
          <Modal.Header className="pt-4 mb-2">
            <h3 className="m-0 mb-2 text-2xl">Blocks</h3>
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
          <Modal.Content className="cursor-pointer">
            <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
              {compositeVariants.map((b) => (
                <Card
                  key={b.name}
                  hover
                  onClick={() => void handleAddItem(b.name, pendingInsertIndex ?? undefined)}
                  className="mb-2"
                >
                  <Card.Header>
                    <Card.Title className="text-xl">{b.label ?? b.name}</Card.Title>
                  </Card.Header>
                  <Card.Content>{b.label ?? b.name}</Card.Content>
                </Card>
              ))}
            </div>
          </Modal.Content>
        </Modal.Container>
      </Modal>
    </div>
  )
}
