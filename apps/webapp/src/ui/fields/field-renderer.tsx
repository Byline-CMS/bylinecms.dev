/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useEffect, useMemo, useState } from 'react'

import type { ArrayField as ArrayFieldType, Field } from '@byline/core'
import { resolveFieldDefaultValue } from '@byline/core'
import {
  Card,
  ChevronDownIcon,
  CloseIcon,
  GripperVerticalIcon,
  IconButton,
  Modal,
  PlusIcon,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import { DraggableSortable, moveItem, useSortable } from '@/ui/dnd/draggable-sortable'
import { CheckboxField } from '../fields/checkbox/checkbox-field'
import { useFormContext } from '../fields/form-context'
import { RichTextField } from '../fields/richtext/richtext-lexical/richtext-field'
import { SelectField } from '../fields/select/select-field'
import { TextField } from '../fields/text/text-field'
import { TextAreaField } from '../fields/text-area/text-area-field'
import { useFieldChangeHandler } from '../fields/use-field-change-handler'
import { DateTimeField } from './datetime/datetime-field'
import { DraggableContextMenu } from './draggable-context-menu'
import { FileField } from './file/file-field'
import { ImageField } from './image/image-field'
import { NumericalField } from './numerical/numerical-field'

const SortableItem = ({
  id,
  label,
  children,
  onAddBelow,
  onRemove,
}: {
  id: string
  label: ReactNode
  children: ReactNode
  onAddBelow?: () => void
  onRemove?: () => void
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: {
      duration: 250,
      easing: 'cubic-bezier(0, 0.2, 0.2, 1)',
    },
  })

  const [collapsed, setCollapsed] = useState(false)

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx('p-4 pt-2 border border-dashed border-gray-600 rounded-md', {
        'shadow-sm bg-canvas-50/50 dark:bg-canvas-800': !isDragging,
        'shadow-md bg-canvas-50/80 dark:bg-canvas-700/30': isDragging,
        'pt-2 pb-2': collapsed,
      })}
    >
      <div className={cx('flex items-center gap-2 mb-0 -ml-3', { 'mb-2': !collapsed })}>
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-400 flex items-center justify-center"
          {...attributes}
          {...listeners}
        >
          <GripperVerticalIcon className="w-4 h-4 text-primary-500 dark:text-primary-200" />
        </button>
        <div className="text-[1rem] font-medium flex-1 min-w-0 truncate">{label}</div>
        <DraggableContextMenu lng='en' onAddBelow={onAddBelow} onRemove={onRemove} />
        <button
          type="button"
          className="p-1 rounded hover:bg-gray-800 text-gray-400 flex items-center justify-center"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? 'Expand item' : 'Collapse item'}
        >
          <ChevronDownIcon
            className={cx('w-4 h-4 transition-transform', {
              'rotate-180': collapsed,
            })}
          />
        </button>
      </div>
      <div
        className={cx('flex flex-col relative gap-4 transition-all duration-200', {
          'max-h-0 opacity-0 -z-10': collapsed,
          'opacity-100': !collapsed,
        })}
      >
        {children}
      </div>
    </div>
  )
}

const ArrayField = ({
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
  const [showAddBlockModal, setShowAddBlockModal] = useState(false)
  const [pendingInsertIndex, setPendingInsertIndex] = useState<number | null>(null)

  const blockVariants = useMemo(
    () => (field.fields ?? []).filter((subField) => subField.type === 'block'),
    [field.fields]
  )
  const isBlockArray = blockVariants.length > 0
  const [selectedBlockName, setSelectedBlockName] = useState<string>(() => blockVariants[0]?.name)

  const placeholderStoredFileValue = useMemo(
    () => ({
      file_id: crypto.randomUUID(),
      filename: 'placeholder',
      original_filename: 'placeholder',
      mime_type: 'application/octet-stream',
      file_size: 0,
      storage_provider: 'placeholder',
      storage_path: 'pending',
      storage_url: null,
      file_hash: null,
      image_width: null,
      image_height: null,
      image_format: null,
      processing_status: 'pending',
      thumbnail_generated: false,
    }),
    []
  )

  const placeholderForField = useMemo(
    () =>
      (f: Field): any => {
        switch (f.type) {
          case 'text':
          case 'textArea':
            return ''
          case 'checkbox':
            return false
          case 'integer':
            return 0
          case 'richText':
          case 'datetime':
            return undefined
          case 'select':
            return ''
          case 'file':
          case 'image':
            // Must be non-null for storage/reconstruct; this is a temporary stub until upload UI exists.
            return placeholderStoredFileValue
          default:
            return null
        }
      },
    [placeholderStoredFileValue]
  )

  useEffect(() => {
    if (!isBlockArray) return
    if (selectedBlockName == null || !blockVariants.some((b) => b.name === selectedBlockName)) {
      setSelectedBlockName(blockVariants[0]?.name)
    }
  }, [blockVariants, isBlockArray, selectedBlockName])

  useEffect(() => {
    if (Array.isArray(defaultValue)) {
      // Block fields are currently represented as an array of single-key objects.
      // When some values are undefined/null they may be skipped during flattening, which can
      // reconstruct as sparse arrays with holes. Normalize to a dense per-field array.
      const isBlockField = (field as any).type === 'block' && Array.isArray((field as any).fields)
      const normalized = isBlockField
        ? ((field as any).fields as Field[]).map((blockChildField) => {
          const found = defaultValue.find(
            (el: any) =>
              el != null && typeof el === 'object' && Object.hasOwn(el, blockChildField.name)
          )
          return found ?? { [blockChildField.name]: placeholderForField(blockChildField) }
        })
        : defaultValue

      setItems(
        normalized.map((item: any) => ({
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
  }, [defaultValue, field, placeholderForField])

  const handleDragEnd = ({
    moveFromIndex,
    moveToIndex,
  }: {
    moveFromIndex: number
    moveToIndex: number
  }) => {
    setItems((prev) => moveItem(prev, moveFromIndex, moveToIndex))
    console.log('ArrayField.handleDragEnd', { moveFromIndex, moveToIndex })
    // Emit an array.move patch against the array so the server can reorder items.
    // We resolve the itemId from the current array value rather than relying on local UI wrapper IDs.
    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]
    console.log('ArrayField.handleDragEnd', { path, currentArray })

    if (Array.isArray(currentArray)) {
      const clampedFrom = Math.max(0, Math.min(moveFromIndex, currentArray.length - 1))
      const clampedTo = Math.max(0, Math.min(moveToIndex, currentArray.length - 1))
      if (clampedFrom === clampedTo) return

      const item = currentArray[clampedFrom]
      console.log('ArrayField.handleDragEnd item', { clampedFrom, clampedTo, item })

      // Use stable id when present; otherwise fall back to index-based id
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
    // NOTE: Array elements in this prototype behave like a tagged union:
    // each item should select ONE sub-field variant (legacy shape: { variantName: value }).
    // Defensive: for block arrays, only allow inserting block variants derived from the schema.
    setShowAddBlockModal(false)
    setPendingInsertIndex(null)
    const variants = isBlockArray ? blockVariants : (field.fields ?? [])
    const variant =
      (forcedVariantName != null
        ? variants.find((v) => v.name === forcedVariantName)
        : undefined) ?? variants[0]

    if (!variant) {
      return
    }

    if (isBlockArray && variant.type !== 'block') {
      return
    }

    const defaultScalarForField = async (f: Field): Promise<any> => {
      const schemaDefault = await resolveFieldDefaultValue(f, {
        data: getFieldValues(),
        now: () => new Date(),
        uuid: () => crypto.randomUUID(),
      })

      if (schemaDefault !== undefined) {
        return schemaDefault
      }

      switch (f.type) {
        case 'text':
        case 'textArea':
          return ''
        case 'checkbox':
          return false
        case 'integer':
          return 0
        case 'richText':
          // Keep undefined so richtext widgets can initialize cleanly.
          return undefined
        case 'datetime':
          return undefined
        case 'select':
          return ''
        case 'file':
        case 'image':
          // Must be non-null for storage/reconstruct; this is a temporary stub until upload UI exists.
          return placeholderStoredFileValue
        default:
          return null
      }
    }

    const defaultValueForVariant = async (v: Field): Promise<any> => {
      if (v.type === 'array' && v.fields && v.fields.length > 0) {
        // Nested array field (e.g. reviews -> reviewItem[])
        const inner = await Promise.all(
          v.fields.map(async (innerField) => ({
            [innerField.name]: await defaultScalarForField(innerField),
          }))
        )
        return inner
      }

      if (v.type === 'block' && (v as any).fields && Array.isArray((v as any).fields)) {
        // Legacy block value shape: an array of single-key objects, one per field.
        const blockFields = (v as any).fields as Field[]
        const inner = await Promise.all(
          blockFields.map(async (blockField) => ({
            [blockField.name]: await defaultScalarForField(blockField),
          }))
        )
        return inner
      }

      return defaultScalarForField(v)
    }

    const newId = crypto.randomUUID()

    const newItem =
      variant.type === 'block'
        ? {
          id: newId,
          type: 'block',
          name: variant.name,
          fields: await defaultValueForVariant(variant),
        }
        : {
          [variant.name]: await defaultValueForVariant(variant),
        }

    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]
    const insertAt = atIndex != null ? atIndex : (currentArray ? currentArray.length : 0)

    // Add to local state at the correct position
    const newItemWrapper = { id: newId, data: newItem }
    setItems((prev) => {
      const next = [...prev]
      next.splice(insertAt, 0, newItemWrapper)
      return next
    })

    // Emit array.insert patch
    appendPatch({
      kind: 'array.insert',
      path: path,
      index: insertAt,
      item: newItem,
    })

    // Update the form store without emitting a field.set patch
    const newArrayValue = currentArray ? [...currentArray] : []
    newArrayValue.splice(insertAt, 0, newItem)
    setFieldStore(path, newArrayValue)
  }

  const handleRemoveItem = (index: number) => {
    const currentArray = (getFieldValue(path) ?? defaultValue) as any[]
    if (!Array.isArray(currentArray) || index < 0 || index >= currentArray.length) return

    const item = currentArray[index]

    // Use stable id when present; otherwise fall back to index-based id
    const itemId =
      item && typeof item === 'object' && 'id' in item
        ? String((item as { id: string }).id)
        : String(index)

    // Remove from local state
    setItems((prev) => prev.filter((_, i) => i !== index))

    // Emit array.remove patch
    appendPatch({
      kind: 'array.remove',
      path: path,
      itemId,
    })

    // Update the form store without emitting a field.set patch
    const newArrayValue = [...currentArray]
    newArrayValue.splice(index, 1)
    setFieldStore(path, newArrayValue)
  }

  const handleInsertBelow = (index: number, forcedVariantName?: string) => {
    if (isBlockArray && blockVariants.length > 1 && forcedVariantName == null) {
      // Multiple block variants — show the picker modal with the insertion position stored
      setPendingInsertIndex(index + 1)
      setShowAddBlockModal(true)
    } else {
      void handleAddItem(forcedVariantName, index + 1)
    }
  }

  const renderItem = (itemWrapper: { id: string; data: any }, index: number) => {
    const item = itemWrapper.data
    // Use an index-based array path that matches the patch grammar,
    // e.g. `content[0]`, and let FieldRenderer append the field name.
    const arrayElementPath = `${path}[${index}]`

    let subField: Field | undefined
    let initial: any
    let label: ReactNode | undefined

    // New block shape: { id, type: 'block', name, fields, meta }
    if (
      item &&
      typeof item === 'object' &&
      item.type === 'block' &&
      typeof item.name === 'string'
    ) {
      subField = field.fields?.find((f) => f.name === item.name)
      initial = item.fields
      label = subField?.label ?? item.name
    } else {
      if (!item || typeof item !== 'object') {
        return null
      }
      // Legacy shape: { blockName: [ { fieldName: value }, ... ] } or generic array item
      // Skip _id (injected stable identity) when finding the data field key.
      const outerKey = Object.keys(item).find((k) => k !== '_id')
      if (outerKey == null) {
        return null
      }
      subField = field.fields?.find((f) => f.name === outerKey)
      initial = item[subField?.name ?? outerKey]
      label = subField?.label ?? outerKey
    }

    if (subField == null) return null

    // Special handling for nested array subfields (e.g. reviews -> reviewItem[])
    if (subField.type === 'array' && subField.fields && subField.fields.length > 0) {
      const innerArray = Array.isArray(initial) ? initial : []

      const innerBody = subField.fields.map((innerField) => {
        const idx = innerArray.findIndex((el) => el && innerField.name in el)
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
          {disableSorting ? null : isBlockArray ? (
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
          ) : (
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
          )}
        </DraggableSortable>
      )}
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
              {blockVariants.map((b) => (
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

interface FieldRendererProps {
  field: Field
  defaultValue?: any
  basePath?: string
  disableSorting?: boolean
  hideLabel?: boolean
}

export const FieldRenderer = ({
  field,
  defaultValue,
  basePath,
  disableSorting,
  hideLabel,
}: FieldRendererProps) => {
  const path = basePath ? `${basePath}.${field.name}` : field.name
  const htmlId = path.replace(/[[\].]/g, '-')

  const handleChange = useFieldChangeHandler(field, path)

  switch (field.type) {
    case 'text':
      return (
        <TextField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'textArea':
      return (
        <TextAreaField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'checkbox':
      return (
        <CheckboxField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'select':
      return (
        <SelectField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'richText':
      return (
        <RichTextField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          instanceKey={htmlId}
        />
      )
    case 'datetime':
      return (
        <DateTimeField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'integer':
      return (
        <NumericalField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'file':
      return (
        <FileField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
        />
      )
    case 'image':
      return (
        <ImageField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
        />
      )
    case 'block':
      // For now, render blocks using the same mechanics as arrays,
      // but with sorting disabled so internal ordering is fixed.
      return (
        <ArrayField
          field={field as unknown as ArrayFieldType}
          defaultValue={defaultValue}
          path={path}
          disableSorting={true}
        />
      )
    case 'array':
      if (!field.fields) return null
      return (
        <ArrayField
          field={field}
          defaultValue={defaultValue}
          path={path}
          disableSorting={disableSorting}
        />
      )
    default:
      return null
  }
}
