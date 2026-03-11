/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo } from 'react'

import type { Field, GroupField as GroupFieldType } from '@byline/core'
import { ErrorText } from '@infonomic/uikit/react'

import { placeholderForField } from '@/ui/fields/field-helpers'
import { FieldRenderer } from '@/ui/fields/field-renderer'
import { useFieldError } from '@/ui/forms/form-context'

// ---------------------------------------------------------------------------
// GroupField — renders a fixed-order group of child fields wrapped in a
// single div. No drag-and-drop. No add/remove.
// The outer div carries the field type ('group') and field name as classes
// so consumers can target individual groups via CSS.
// ---------------------------------------------------------------------------

interface GroupFieldProps {
  field: GroupFieldType
  defaultValue: any
  path: string
}

export const GroupField = ({ field, defaultValue, path }: GroupFieldProps) => {
  const fieldError = useFieldError(field.name)
  // Default value for a group field is a plain object: { rating: 5, comment: '...' }
  // Normalize to a plain object if not already one.
  const groupData = useMemo(() => {
    if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      return defaultValue
    }
    // Fallback: build a placeholder object from child field definitions
    const placeholder: Record<string, any> = {}
    for (const childField of field.fields as Field[]) {
      placeholder[childField.name] = placeholderForField(childField)
    }
    return placeholder
  }, [defaultValue, field.fields])

  return (
    <div className={`byline-group ${field.name}`}>
      {field.label && (
        <div className="flex flex-col gap-0.5 mb-2">
          <h3 className="text-[1rem] font-medium">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </h3>
          {field.helpText && <p className="muted text-xs text-muted">{field.helpText}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {(field.fields as Field[]).map((innerField) => {
          return (
            <FieldRenderer
              key={innerField.name}
              field={innerField}
              defaultValue={groupData[innerField.name]}
              basePath={path}
              disableSorting={true}
            />
          )
        })}
      </div>
      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
    </div>
  )
}
