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
import { SortableItem } from '@/ui/fields/sortable-item'
import { useFormContext } from '@/ui/forms/form-context'

// ---------------------------------------------------------------------------
// ArrayField — renders `type: 'array'` fields. Children are homogeneous:
// either single value fields or a single group definition. Supports D&D.
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
    const childFields = field.fields ?? []
    if (childFields.length === 0) return

    const newId = crypto.randomUUID()

    // Build a new item with default values for ALL child fields
    const newItem: Record<string, any> = {}
    for (const childField of childFields) {
      if (childField.type === 'group' && childField.fields && childField.fields.length > 0) {
        // Group child — build a nested object with defaults for each inner field
        const groupObj: Record<string, any> = {}
        for (const innerField of childField.fields as Field[]) {
          groupObj[innerField.name] = await defaultScalarForField(innerField, getFieldValues)
        }
        newItem[childField.name] = groupObj
      } else {
        newItem[childField.name] = await defaultScalarForField(childField, getFieldValues)
      }
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

  const handleInsertBelow = (index: number) => {
    void handleAddItem(index + 1)
  }

  const renderItem = (itemWrapper: { id: string; data: any }, index: number) => {
    const item = itemWrapper.data
    const arrayElementPath = `${path}[${index}]`

    if (!item || typeof item !== 'object') return null

    const childFields = field.fields ?? []
    if (childFields.length === 0) return null

    // Render ALL child fields defined in the array's field schema
    const innerBody = childFields.map((childField) => {
      const initial = item[childField.name]

      if (childField.type === 'group' && childField.fields && childField.fields.length > 0) {
        // Group child — render its inner fields with the group's sub-object
        const groupData = initial && typeof initial === 'object' ? initial : {}
        return (
          <div key={childField.name} className="flex flex-col gap-4">
            {childField.label && <h4 className="text-[0.9rem] font-medium">{childField.label}</h4>}
            {(childField.fields as Field[]).map((innerField) => (
              <FieldRenderer
                key={innerField.name}
                field={innerField}
                defaultValue={groupData[innerField.name]}
                basePath={`${arrayElementPath}.${childField.name}`}
                disableSorting={true}
              />
            ))}
          </div>
        )
      }

      return (
        <FieldRenderer
          key={childField.name}
          field={childField}
          defaultValue={initial}
          basePath={arrayElementPath}
          disableSorting={true}
        />
      )
    })

    const label = field.label ?? field.name

    if (disableSorting) {
      return (
        <div
          key={itemWrapper.id}
          className="p-4 border border-dashed border-gray-600 rounded-md flex flex-col gap-4"
        >
          <div className="flex flex-col gap-4">{innerBody}</div>
        </div>
      )
    }

    return (
      <SortableItem
        key={itemWrapper.id}
        id={itemWrapper.id}
        label={label}
        onAddBelow={() => handleInsertBelow(index)}
        onRemove={() => handleRemoveItem(index)}
      >
        <div className="flex flex-col gap-4">{innerBody}</div>
      </SortableItem>
    )
  }

  return (
    <div className={`byline-array ${field.name}`}>
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
