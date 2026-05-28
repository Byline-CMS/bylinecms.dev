/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import type {
  CollectionAdminConfig,
  CollectionDefinition,
  RelationField as FieldType,
  RelatedDocumentValue,
} from '@byline/core'
import { getCollectionAdminConfig, getCollectionDefinition } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, CloseIcon, EditIcon, ErrorText, IconButton, Label } from '@byline/ui/react'
import cx from 'classnames'

import { useFieldError, useFieldValue } from '../../forms/form-context'
import styles from './relation-field.module.css'
import { RelationPicker } from './relation-picker'
import { RelationSummary } from './relation-summary'

// The raw form value for a relation field is `RelatedDocumentValue`, but
// when the edit loader runs server-side populate the value arrives as a
// `PopulatedRelationValue` (same base shape, plus `_resolved` / `document`
// discriminator keys). We accept both here and let `RelationSummary`
// narrow internally.
type IncomingRelationValue = RelatedDocumentValue & {
  _resolved?: boolean
  _cycle?: boolean
  document?: Record<string, any>
}

// ---------------------------------------------------------------------------
// RelationField — widget for `type: 'relation'` fields
// ---------------------------------------------------------------------------

interface RelationFieldProps {
  field: FieldType
  value?: RelatedDocumentValue | null
  defaultValue?: RelatedDocumentValue | null
  onChange?: (value: RelatedDocumentValue | null) => void
  id?: string
  path?: string
}

export const RelationField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
}: RelationFieldProps) => {
  const fieldPath = path ?? field.name
  const htmlId = id ?? fieldPath
  const fieldError = useFieldError(fieldPath)
  const fieldValue = useFieldValue<IncomingRelationValue | null | undefined>(fieldPath)

  const incomingValue: IncomingRelationValue | null =
    fieldValue !== undefined
      ? ((fieldValue as IncomingRelationValue | null) ?? null)
      : ((value as IncomingRelationValue | null) ??
        (defaultValue as IncomingRelationValue | null) ??
        null)

  // Resolve the target collection definition + admin config. The admin
  // config drives the picker-column rendering inside RelationSummary so
  // the selected tile matches the picker row exactly. Missing target →
  // render an inline error and disable the picker.
  const targetDef: CollectionDefinition | null = getCollectionDefinition(field.targetCollection)
  const targetAdminConfig: CollectionAdminConfig | null = getCollectionAdminConfig(
    field.targetCollection
  )

  const { t } = useTranslation('byline-admin')
  const [pickerOpen, setPickerOpen] = useState(false)
  // Cached target document from the most recent picker selection. Lets the
  // tile render real display data (name, thumbnail) immediately after a
  // pick without a round trip. Cleared via the `targetDocumentId`
  // comparison in the render path.
  const [pickedRecord, setPickedRecord] = useState<{
    id: string
    record: Record<string, any>
  } | null>(null)

  const handleSelect = (selection: {
    targetDocumentId: string
    targetCollectionId: string
    record?: Record<string, any>
  }) => {
    setPickerOpen(false)
    if (selection.record) {
      setPickedRecord({ id: selection.targetDocumentId, record: selection.record })
    } else {
      setPickedRecord(null)
    }
    onChange?.({
      targetDocumentId: selection.targetDocumentId,
      targetCollectionId: selection.targetCollectionId,
    })
  }

  const handleRemove = () => {
    setPickedRecord(null)
    onChange?.(null)
  }

  // Only carry the cached picker record through to the summary when it
  // still matches the current value — guards against a stale cache after
  // an external value change (e.g. patch rollback).
  const cachedRecord =
    pickedRecord && incomingValue && pickedRecord.id === incomingValue.targetDocumentId
      ? pickedRecord.record
      : null

  const isUnknown = targetDef == null

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
      {field.helpText && (
        <div className={cx('byline-field-relation-help', styles.help)}>{field.helpText}</div>
      )}

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
      ) : incomingValue ? (
        <div className={cx('byline-field-relation-tile', styles.tile)}>
          <RelationSummary
            targetDefinition={targetDef}
            targetAdminConfig={targetAdminConfig}
            displayField={field.displayField}
            value={incomingValue}
            cachedRecord={cachedRecord}
          />
          <div className={cx('byline-field-relation-actions', styles.actions)}>
            <IconButton
              id={htmlId}
              type="button"
              intent="noeffect"
              size="xs"
              aria-label={t('fields.relation.changeAriaLabel', {
                label: targetDef.labels.singular,
              })}
              onClick={() => setPickerOpen(true)}
            >
              <EditIcon width="15px" height="15px" />
            </IconButton>
            <IconButton
              type="button"
              intent="noeffect"
              size="xs"
              aria-label={t('fields.relation.removeAriaLabel', {
                label: targetDef.labels.singular,
              })}
              onClick={handleRemove}
            >
              <CloseIcon width="15px" height="15px" />
            </IconButton>
          </div>
        </div>
      ) : (
        <Button
          id={htmlId}
          size="xs"
          variant="outlined"
          intent="noeffect"
          type="button"
          onClick={() => setPickerOpen(true)}
        >
          {t('fields.relation.selectButton', { label: targetDef.labels.singular })}
        </Button>
      )}

      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}

      {!isUnknown && (
        <RelationPicker
          targetCollectionPath={field.targetCollection}
          targetDefinition={targetDef}
          displayField={field.displayField}
          isOpen={pickerOpen}
          onSelect={handleSelect}
          onDismiss={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
