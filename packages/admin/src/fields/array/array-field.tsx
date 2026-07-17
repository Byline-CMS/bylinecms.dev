/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import type { ArrayField as ArrayFieldType, Field, FieldAdminConfig } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { DraggableSortable, IconButton, moveItem, PlusIcon } from '@byline/ui/react'
import cx from 'classnames'

import { sliceFieldAdmin } from '../../fields/field-admin'
import { defaultScalarForField } from '../../fields/field-helpers'
import { FieldRenderer } from '../../fields/field-renderer'
import { SortableItem } from '../../fields/sortable-item'
import { useFormContext } from '../../forms/form-context'
import styles from './array-field.module.css'

// ---------------------------------------------------------------------------
// ArrayField — renders `type: 'array'` fields. Each item renders every child
// field declared in the array's `fields` (value fields and/or groups, in any
// combination). Supports D&D.
// ---------------------------------------------------------------------------

export const ArrayField = ({
  field,
  defaultValue,
  path,
  disableSorting = false,
  collectionPath,
  contentLocale,
  fieldAdmin,
}: {
  field: ArrayFieldType
  defaultValue: any
  path: string
  disableSorting?: boolean
  /**
   * Collection path forwarded to upload-capable fields (`file` / `image`)
   * nested inside an array item, which need it to reach the `/upload`
   * endpoint. Without it those fields fall back to their empty placeholder
   * and never render an upload widget.
   */
  collectionPath?: string
  /**
   * Active content locale, forwarded to each array item's fields so
   * localized widgets nested inside an array (e.g. a `localized` richText)
   * can render their locale badge.
   */
  contentLocale?: string
  /**
   * Admin overrides for the array's child fields, keyed by dotted,
   * index-free schema paths relative to this array ('answer',
   * 'filesGroup.publicationFile'). Schema paths address declarations, so
   * one entry applies to that field in every item. Arrives pre-sliced from
   * the enclosing widget (`FieldRenderer` / `GroupField`); exact-name
   * entries apply to the child, deeper entries are re-sliced and threaded
   * on (see `sliceFieldAdmin`).
   */
  fieldAdmin?: Record<string, FieldAdminConfig>
}) => {
  const { appendPatch, getFieldValue, getFieldValues, setFieldStore } = useFormContext()
  const { t } = useTranslation('byline-admin')
  const [items, setItems] = useState<{ id: string; data: any }[]>([])

  useEffect(() => {
    // Prefer the live form-store value over `defaultValue` when seeding the
    // rendered list. The store lives in FormProvider — above the tab layout —
    // so it survives this field unmounting/remounting as the editor switches
    // tabs; `defaultValue` is only the initial seed and is empty in create
    // mode. Re-seeding from `defaultValue` on remount would drop items the
    // editor had already added on an earlier visit to this tab.
    const storeValue = getFieldValue(path)
    const source = Array.isArray(storeValue) ? storeValue : defaultValue
    if (Array.isArray(source)) {
      setItems(
        source.map((item: any) => ({
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
  }, [defaultValue, getFieldValue, path])

  /**
   * Stable patch identity for an array item. Persisted items carry `_id`
   * (the array-item identity from `store_meta`) — that is what the server's
   * patch engine matches on (`applyArrayPatch`: `item._id === patch.itemId`),
   * so it MUST be preferred here. `id` is accepted as a legacy/seed-data
   * alias. Items added this session have neither (the storage layer assigns
   * `_id` at write time), so fall back to the item's current index — the
   * patch engine resolves a pure-integer itemId as an index fallback.
   */
  const patchItemId = (item: unknown, index: number): string => {
    if (item && typeof item === 'object') {
      if ('_id' in item) return String((item as { _id: string })._id)
      if ('id' in item) return String((item as { id: string }).id)
    }
    return String(index)
  }

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

      appendPatch({
        kind: 'array.move',
        path: path,
        itemId: patchItemId(item, clampedFrom),
        toIndex: clampedTo,
      })
    }
  }

  const handleAddItem = async (atIndex?: number) => {
    const childFields = field.fields ?? []
    if (childFields.length === 0) return

    const newId = crypto.randomUUID()

    // Build a new item with default values for ALL child fields.
    // Assign the stable `_id` client-side — exactly like BlocksField's
    // handleAddItem — so the item is patch-addressable (move / remove by
    // `_id`) within the same editing session, before any server write has
    // assigned identity. The storage layer persists `_id` via store_meta.
    const newItem: Record<string, any> = { _id: newId }
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

    setItems((prev) => prev.filter((_, i) => i !== index))

    appendPatch({
      kind: 'array.remove',
      path: path,
      itemId: patchItemId(item, index),
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
        // Group child — render its inner fields with the group's sub-object.
        // fieldAdmin slices one level per structural hop: the group's
        // descendant map first, then each inner field's own slice.
        const groupData = initial && typeof initial === 'object' ? initial : {}
        const groupAdmin = sliceFieldAdmin(fieldAdmin, childField.name)
        return (
          <div
            key={childField.name}
            className={cx('byline-field-array-group-fields', styles['group-fields'])}
          >
            {childField.label && (
              <h4 className={cx('byline-field-array-group-header', styles['group-header'])}>
                {childField.label}
              </h4>
            )}
            {(childField.fields as Field[]).map((innerField) => (
              <FieldRenderer
                key={innerField.name}
                field={innerField}
                defaultValue={groupData[innerField.name]}
                basePath={`${arrayElementPath}.${childField.name}`}
                disableSorting={true}
                collectionPath={collectionPath}
                contentLocale={contentLocale}
                components={groupAdmin?.[innerField.name]?.components}
                editor={groupAdmin?.[innerField.name]?.editor}
                fieldAdmin={sliceFieldAdmin(groupAdmin, innerField.name)}
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
          collectionPath={collectionPath}
          contentLocale={contentLocale}
          components={fieldAdmin?.[childField.name]?.components}
          editor={fieldAdmin?.[childField.name]?.editor}
          fieldAdmin={sliceFieldAdmin(fieldAdmin, childField.name)}
        />
      )
    })

    const label = field.label ?? field.name

    if (disableSorting) {
      return (
        <div key={itemWrapper.id} className={cx('byline-field-array-card', styles.card)}>
          <div className={cx('byline-field-array-group-fields', styles['group-fields'])}>
            {innerBody}
          </div>
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
        <div className={cx('byline-field-array-group-fields', styles['group-fields'])}>
          {innerBody}
        </div>
      </SortableItem>
    )
  }

  return (
    <div className={`byline-field-array ${field.name}`}>
      {!disableSorting && field.label && (
        <h3 className={cx('byline-field-array-title', styles.title)}>{field.label}</h3>
      )}
      {disableSorting ? (
        <div className={cx('byline-field-array-stack', styles.stack)}>
          {items.map((item, index) => renderItem(item, index))}
        </div>
      ) : (
        <DraggableSortable
          ids={items.map((i) => i.id)}
          onDragEnd={handleDragEnd}
          className={cx('byline-field-array-stack', styles.stack)}
        >
          {items.map((item, index) => renderItem(item, index))}
          <div className={cx('byline-field-array-add-row', styles['add-row'])}>
            <IconButton
              onClick={() => {
                void handleAddItem()
              }}
              aria-label={t('fields.array.addItemAriaLabel')}
            >
              <PlusIcon />
            </IconButton>
            {/* Text-styled button so the label is clickable too. Removed from
                the tab order (tabIndex -1) — the IconButton is the single
                keyboard/screen-reader control for this action. */}
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                void handleAddItem()
              }}
              className={cx('byline-field-array-add-label', styles['add-label'])}
            >
              {t('fields.array.addItem')}
            </button>
          </div>
        </DraggableSortable>
      )}
    </div>
  )
}
