/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useState } from 'react'

import type {
  CollectionAdminConfig,
  CollectionDefinition,
  RelationField as FieldType,
  RelatedDocumentValue,
} from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import {
  Button,
  CloseIcon,
  DraggableSortable,
  ErrorText,
  GripperVerticalIcon,
  HelpText,
  IconButton,
  Label,
  moveItem,
  PlusIcon,
  useSortable,
} from '@byline/ui/react'
import cx from 'classnames'

import { useFieldError, useFieldValue, useFormContext } from '../../forms/form-context'
import styles from './relation-field.module.css'
import { RelationPicker, type RelationPickerSelection } from './relation-picker'
import { RelationSummary } from './relation-summary'

// A single stored item. On the edit path the loader's populate pass attaches
// `_resolved` / `document`; freshly-picked items are bare refs. Both flatten
// the same way (storage ignores the envelope keys), so we never strip them.
type IncomingRelationValue = RelatedDocumentValue & {
  _resolved?: boolean
  _cycle?: boolean
  document?: Record<string, any>
}

// ---------------------------------------------------------------------------
// RelationManyField — `type: 'relation'` with `hasMany: true`.
//
// An ordered list of summary tiles: drag to reorder, ✕ to remove, "+ Add" to
// open the standard picker and append. The value is an array of relation
// envelopes; every mutation writes the whole array back via `setFieldValue`,
// which emits a coalesced `field.set` patch — relations carry no stable `_id`,
// so the granular `array.*` patches (which key on `_id`) don't apply, and a
// whole-array set is both correct and simplest for these small lists.
// ---------------------------------------------------------------------------

interface RelationManyTileProps {
  id: string
  children: ReactNode
  onRemove: () => void
  removeAriaLabel: string
}

const RelationManyTile = ({ id, children, onRemove, removeAriaLabel }: RelationManyTileProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: { duration: 250, easing: 'cubic-bezier(0, 0.2, 0.2, 1)' },
  })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(
        'byline-field-relation-many-tile',
        styles['many-tile'],
        isDragging && ['byline-field-relation-many-tile-dragging', styles['many-tile-dragging']]
      )}
    >
      <button
        type="button"
        className={cx('byline-field-relation-many-grip', styles['many-grip'])}
        {...attributes}
        {...listeners}
      >
        <GripperVerticalIcon />
      </button>
      <div className={cx('byline-field-relation-many-body', styles['many-body'])}>{children}</div>
      <IconButton
        type="button"
        size="xs"
        intent="noeffect"
        aria-label={removeAriaLabel}
        className={cx('byline-field-relation-many-remove', styles['many-remove'])}
        onClick={onRemove}
      >
        <CloseIcon width="14px" height="14px" />
      </IconButton>
    </div>
  )
}

interface RelationManyFieldProps {
  field: FieldType
  defaultValue?: RelatedDocumentValue[] | null
  id?: string
  path?: string
}

export const RelationManyField = ({ field, defaultValue, id, path }: RelationManyFieldProps) => {
  const fieldPath = path ?? field.name
  const htmlId = id ?? fieldPath
  const { t } = useTranslation('byline-admin')
  const fieldError = useFieldError(fieldPath)
  const { getFieldValue, setFieldValue } = useFormContext()

  const targetDef: CollectionDefinition | null = getCollectionDefinition(field.targetCollection)
  const targetAdminConfig: CollectionAdminConfig | null = getCollectionAdminConfig(
    field.targetCollection
  )
  const isUnknown = targetDef == null
  const targetLabel = targetDef?.labels.singular ?? field.targetCollection

  const [pickerOpen, setPickerOpen] = useState(false)
  // Records handed back by the picker, keyed by target id — lets a freshly
  // added tile render real display data (title / thumbnail) without a refetch.
  const [pickedRecords, setPickedRecords] = useState<Record<string, Record<string, any>>>({})

  // Subscribe to the live array so reorders / adds / removes re-render.
  const liveValue = useFieldValue<IncomingRelationValue[] | undefined>(fieldPath)
  const items: IncomingRelationValue[] = Array.isArray(liveValue)
    ? liveValue
    : Array.isArray(defaultValue)
      ? (defaultValue as IncomingRelationValue[])
      : []

  const currentArray = (): IncomingRelationValue[] => {
    const v = getFieldValue(fieldPath)
    if (Array.isArray(v)) return v as IncomingRelationValue[]
    return Array.isArray(defaultValue) ? (defaultValue as IncomingRelationValue[]) : []
  }

  const handleAddMany = (selections: RelationPickerSelection[]) => {
    setPickerOpen(false)
    const current = currentArray()
    // Dedup the batch against the current array — a target may appear at most
    // once. The picker already disables already-added rows, so this is a
    // belt-and-braces guard for stale state (e.g. a concurrent remove).
    const existing = new Set(current.map((v) => v.targetDocumentId))
    const additions = selections.filter((s) => !existing.has(s.targetDocumentId))
    if (additions.length === 0) return
    const records = additions.filter((s) => s.record != null)
    if (records.length > 0) {
      setPickedRecords((prev) => {
        const next = { ...prev }
        for (const s of records) next[s.targetDocumentId] = s.record!
        return next
      })
    }
    setFieldValue(fieldPath, [
      ...current,
      ...additions.map((s) => ({
        targetDocumentId: s.targetDocumentId,
        targetCollectionId: s.targetCollectionId,
      })),
    ])
  }

  const handleRemove = (targetDocumentId: string) => {
    setFieldValue(
      fieldPath,
      currentArray().filter((v) => v.targetDocumentId !== targetDocumentId)
    )
  }

  const handleDragEnd = ({
    moveFromIndex,
    moveToIndex,
  }: {
    moveFromIndex: number
    moveToIndex: number
  }) => {
    if (moveFromIndex === moveToIndex) return
    setFieldValue(fieldPath, moveItem(currentArray(), moveFromIndex, moveToIndex))
  }

  return (
    <div className={`byline-field-relation ${field.name}`}>
      <div className={cx('byline-field-relation-header', styles.header)}>
        <Label
          id={`${htmlId}-label`}
          htmlFor={htmlId}
          label={field.label ?? field.name}
          required={!field.optional}
        />
      </div>
      {isUnknown ? (
        <div className={cx('byline-field-relation-error-tile', styles['error-tile'])}>
          <span>
            {t('fields.relation.unknownError', {
              name: field.name,
              target: field.targetCollection,
            })}
          </span>
          <span className={cx('byline-field-relation-error-text', styles['error-text'])}>
            {t('fields.relation.unknownHint')}
          </span>
        </div>
      ) : (
        <>
          {/* Rounded frame below the label wrapping the interactive
              body (tile list and add button) — see `.frame` in the CSS
              module. */}
          <div className={cx('byline-field-relation-frame', styles.frame)}>
            {items.length === 0 ? (
              <p className={cx('byline-field-relation-many-empty', styles['many-empty'])}>
                {t('fields.relation.manyEmpty', { label: targetDef.labels.plural })}
              </p>
            ) : (
              <DraggableSortable
                ids={items.map((v) => v.targetDocumentId)}
                onDragEnd={handleDragEnd}
                className={cx('byline-field-relation-many', styles.many)}
              >
                {items.map((value) => (
                  <RelationManyTile
                    key={value.targetDocumentId}
                    id={value.targetDocumentId}
                    onRemove={() => handleRemove(value.targetDocumentId)}
                    removeAriaLabel={t('fields.relation.removeAriaLabel', { label: targetLabel })}
                  >
                    <RelationSummary
                      targetDefinition={targetDef}
                      targetAdminConfig={targetAdminConfig}
                      displayField={field.displayField}
                      value={value}
                      cachedRecord={pickedRecords[value.targetDocumentId] ?? null}
                    />
                  </RelationManyTile>
                ))}
              </DraggableSortable>
            )}

            <div className={cx('byline-field-relation-many-add', styles['many-add'])}>
              <Button
                id={htmlId}
                size="xs"
                variant="outlined"
                intent="noeffect"
                type="button"
                onClick={() => setPickerOpen(true)}
              >
                <PlusIcon width="14px" height="14px" />
                {t('fields.relation.addButton', { label: targetLabel })}
              </Button>
            </div>
          </div>

          {field.helpText != null && <HelpText text={field.helpText} />}

          {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}

          <RelationPicker
            multiple
            targetCollectionPath={field.targetCollection}
            targetDefinition={targetDef}
            displayField={field.displayField}
            isOpen={pickerOpen}
            excludeIds={items.map((v) => v.targetDocumentId)}
            onSelectMany={handleAddMany}
            onDismiss={() => setPickerOpen(false)}
          />
        </>
      )}
    </div>
  )
}
