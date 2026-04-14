/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import type {
  CollectionDefinition,
  RelationField as FieldType,
  RelatedDocumentValue,
} from '@byline/core'
import { getCollectionDefinition } from '@byline/core'
import { Button, ErrorText } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue } from '../../forms/form-context'
import { RelationPicker } from './relation-picker'

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
  const fieldValue = useFieldValue<RelatedDocumentValue | null | undefined>(fieldPath)

  const incomingValue: RelatedDocumentValue | null =
    fieldValue !== undefined ? (fieldValue ?? null) : (value ?? defaultValue ?? null)

  // Resolve the target collection definition for labels + displayField fallback.
  // Missing target → render an inline error and disable the picker.
  const targetDef: CollectionDefinition | null = getCollectionDefinition(field.targetCollection)

  const [pickerOpen, setPickerOpen] = useState(false)

  const handleSelect = (selection: {
    target_document_id: string
    target_collection_id: string
  }) => {
    setPickerOpen(false)
    onChange?.({
      target_document_id: selection.target_document_id,
      target_collection_id: selection.target_collection_id,
    })
  }

  const handleRemove = () => {
    onChange?.(null)
  }

  const isUnknown = targetDef == null

  return (
    <div className={`byline-relation ${field.name}`}>
      <div className="flex items-baseline gap-2 mb-1">
        <div>
          <label
            htmlFor={htmlId}
            id={`${htmlId}-label`}
            className="text-sm font-medium text-gray-100"
          >
            {field.label ?? field.name}
            {field.optional ? '' : ' *'}
          </label>
          {field.helpText && <div className="mt-0.5 text-xs text-gray-400">{field.helpText}</div>}
        </div>
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
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-gray-500">{targetDef.labels.singular}</span>
            <span className="font-mono truncate">{incomingValue.target_document_id}</span>
          </div>
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
