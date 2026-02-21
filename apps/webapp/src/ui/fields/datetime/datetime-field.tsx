/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DateTimeField as FieldType } from '@byline/core'
import { DatePicker } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue, useIsDirty } from '../../fields/form-context'

export const DateTimeField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
}: {
  field: FieldType
  value?: Date | null
  defaultValue?: Date | null
  onChange?: (value: Date | null) => void
  id?: string
  path?: string
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<Date | null | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? null

  return (
    <div>
      <DatePicker
        id={id ?? fieldPath}
        name={field.name}
        label={field.label}
        required={field.required}
        initialValue={incomingValue}
        mode={field.mode || 'datetime'}
        yearsInFuture={field.yearsInFuture || 1}
        yearsInPast={field.yearsInPast || 10}
        onDateChange={(date) => onChange?.(date)}
        className={isDirty ? 'border-blue-300' : ''}
      />
      {fieldError && <div className="mt-1 text-xs text-red-400">{fieldError}</div>}
    </div>
  )
}
