/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import type { ArrayField as ArrayFieldType, Field } from '@byline/core'
import { IconButton, PlusIcon } from '@infonomic/uikit/react'

import { DraggableSortable, moveItem } from '@/ui/dnd/draggable-sortable'
import { defaultScalarForField } from '@/ui/fields/field-helpers'
import { FieldRenderer } from '@/ui/fields/field-renderer'
import { useFormContext } from '@/ui/fields/form-context'
import { SortableItem } from '@/ui/fields/sortable-item'

// ---------------------------------------------------------------------------
// ArrayField — renders `type: 'array'` fields. Children are homogeneous:
// either single value fields or a single composite definition. Supports D&D.
// ---------------------------------------------------------------------------

export const ArrayField = ({
  field,
  defaultValue,
  path,
  disableSorting = false,
}: {
  field: ArrayFieldType
  defaultValue: any
  path: string
  disableSorting?: boolean
}) => {
  const { appendPatch, getFieldValue, getFieldValues, setFieldStore } = useFormContext()
  const [items, setItems] = useState<{ id: string; data: any }[]>([])

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

  const handleAddItem = async (atIndex?: number) => {
    const variants = field.fields ?? []
    const variant = variants[0]
    if (!variant) return

    const defaultValueForVariant = async (v: Field): Promise<any> => {
      // Composite child — build array of single-key objects
      if (v.type === 'composite' && v.fields && v.fields.length > 0) {
        const inner = await Promise.all(
          (v.fields as Field[]).map(async (innerField) => ({
            [innerField.name]: await defaultScalarForField(innerField, getFieldValues),
          }))
        )
        return inner
      }
      return defaultScalarForField(v, getFieldValues)
    }

    const newId = crypto.randomUUID()
    const newItem = { [variant.name]: await defaultValueForVariant(variant) }

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

  const handleInsertBelow = (index: number) => {
    void handleAddItem(index + 1)
  }

  const renderItem = (itemWrapper: { id: string; data: any }, index: number) => {
    const item = itemWrapper.data
    const arrayElementPath = `${path}[${index}]`

    if (!item || typeof item !== 'object') return null

    // Skip _id (stable identity injected during read)
    const outerKey = Object.keys(item).find((k) => k !== '_id')
    if (outerKey == null) return null

    const subField = field.fields?.find((f) => f.name === outerKey)
    const initial = item[subField?.name ?? outerKey]
    const label = subField?.label ?? outerKey

    if (subField == null) return null

    // Composite child — render its fields inline
    if (subField.type === 'composite' && subField.fields && subField.fields.length > 0) {
      const innerArray = Array.isArray(initial) ? initial : []

      const innerBody = (subField.fields as Field[]).map((innerField) => {
        const idx = innerArray.findIndex((el: any) => el && innerField.name in el)
        const elementIndex = idx >= 0 ? idx : 0
        const element = innerArray[elementIndex] ?? {}

        return (
          <FieldRenderer
            key={innerField.name}
            field={innerField}
            defaultValue={element[innerField.name]}
            basePath={`${arrayElementPath}.${subField.name}[${elementIndex}]`}
            disableSorting={true}
          />
        )
      })

      if (disableSorting) {
        return (
          <div
            key={itemWrapper.id}
            className="p-4 border border-dashed border-gray-600 rounded-md flex flex-col gap-4"
          >
            {subField.label && <h3 className="text-[1rem] font-medium mb-1">{subField.label}</h3>}
            <div className="flex flex-col gap-4">{innerBody}</div>
          </div>
        )
      }

      return (
        <SortableItem
          key={itemWrapper.id}
          id={itemWrapper.id}
          label={subField.label ?? ''}
          onAddBelow={() => handleInsertBelow(index)}
          onRemove={() => handleRemoveItem(index)}
        >
          <div className="flex flex-col gap-4">{innerBody}</div>
        </SortableItem>
      )
    }

    // Simple value field child
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

    if (disableSorting) {
      return (
        <div
          key={itemWrapper.id}
          className="p-4 border border-dashed border-gray-600 rounded-md flex flex-col gap-4"
        >
          {label && <h3 className="text-[1rem] font-medium mb-1">{label}</h3>}
          {body}
        </div>
      )
    }

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
      {!disableSorting && field.label && (
        <h3 className="text-[1rem] font-medium mb-1">{field.label}</h3>
      )}
      {disableSorting ? (
        <div className="flex flex-col gap-4">
          {items.map((item, index) => renderItem(item, index))}
        </div>
      ) : (
        <DraggableSortable
          ids={items.map((i) => i.id)}
          onDragEnd={handleDragEnd}
          className="flex flex-col gap-4"
        >
          {items.map((item, index) => renderItem(item, index))}
          <span>
            <IconButton
              onClick={() => {
                void handleAddItem()
              }}
              aria-label="Add item"
            >
              <PlusIcon />
            </IconButton>
          </span>
        </DraggableSortable>
      )}
    </div>
  )
}
