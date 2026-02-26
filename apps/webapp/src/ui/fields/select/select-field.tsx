/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SelectField as FieldType } from '@byline/core'
import { Select, SelectItem } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue, useIsDirty } from '../../fields/form-context'

export const SelectField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
}: {
  field: FieldType
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  id?: string
  path?: string
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<string | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? ''

  return (
    <div className={`byline-select ${field.name}`}>
      <Select
        size="sm"
        id={id ?? fieldPath}
        name={field.name}
        placeholder="Select an option"
        required={field.required}
        value={incomingValue}
        helpText={field.helpText}
        onValueChange={(value) => onChange?.(value)}
        className={isDirty ? 'border-blue-300' : ''}
      >
        {field.options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </Select>
      {fieldError && <div className="mt-1 text-xs text-red-400">{fieldError}</div>}
    </div>
  )
}
