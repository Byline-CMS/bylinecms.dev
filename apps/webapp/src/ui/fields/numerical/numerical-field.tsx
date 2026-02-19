/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
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
