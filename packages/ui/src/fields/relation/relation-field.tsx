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
import { Button, ErrorText, Label } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue } from '../../forms/form-context'
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
    <div className={`byline-relation ${field.name}`}>
      <div className="flex items-baseline gap-2 mb-1">
        <Label
          id={`${htmlId}-label`}
          htmlFor={htmlId}
          label={field.label ?? field.name}
          required={!field.optional}
        />
        {incomingValue && !isUnknown && (
          <button
            type="button"
            className="text-xs text-red-500 hover:text-red-400 underline-offset-2 hover:underline"
            onClick={handleRemove}
          >
            Remove
          </button>
        )}
      </div>
      {field.helpText && <div className="mb-1 text-xs text-gray-400">{field.helpText}</div>}

      {isUnknown ? (
        <div className="mt-1 flex flex-col gap-1 border border-red-700 bg-red-900/20 p-2 rounded-md text-xs text-red-200">
          <span>
            Relation field <code className="font-mono">{field.name}</code> targets unknown
            collection <code className="font-mono">{field.targetCollection}</code>.
          </span>
          <span className="text-red-400/80">
            Register the collection in your Byline config or correct the target path.
          </span>
        </div>
      ) : incomingValue ? (
        <div className="mt-1 flex items-center justify-between gap-2 border border-primary-500 p-2 rounded-md text-xs text-gray-200">
          <RelationSummary
            targetDefinition={targetDef}
            targetAdminConfig={targetAdminConfig}
            displayField={field.displayField}
            value={incomingValue}
            cachedRecord={cachedRecord}
          />
          <Button
            id={htmlId}
            size="xs"
            variant="outlined"
            intent="noeffect"
            type="button"
            onClick={() => setPickerOpen(true)}
          >
            Change
          </Button>
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
          Select {targetDef.labels.singular}…
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
