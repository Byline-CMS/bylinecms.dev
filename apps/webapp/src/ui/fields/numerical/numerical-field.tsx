/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DecimalField, FloatField, IntegerField } from '@byline/core'
import { Input } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue, useIsDirty } from '../form-context'

export const NumericalField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
}: {
  field: IntegerField | FloatField | DecimalField
  value?: string | number | null
  defaultValue?: string | number | null
  onChange?: (value: string) => void
  id?: string
  path?: string
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<string | number | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? ''

  return (
    <div>
      <Input
        type="number"
        id={id ?? fieldPath}
        name={field.name}
        label={field.label}
        required={field.required}
        helpText={field.helpText}
        value={incomingValue === undefined || incomingValue === null ? '' : String(incomingValue)}
        onChange={(e) => onChange?.(e.target.value)}
        error={fieldError != null}
        errorText={fieldError}
        className={isDirty ? 'border-blue-300' : ''}
      />
    </div>
  )
}
