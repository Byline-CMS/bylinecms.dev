/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CheckboxField as FieldType } from '@byline/core'
import { Checkbox } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue } from '../../fields/form-context'

export const CheckboxField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
}: {
  field: FieldType
  value?: boolean
  defaultValue?: boolean
  onChange?: (value: boolean) => void
  id?: string
  path?: string
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  // const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<boolean | undefined>(fieldPath)
  const checked = value ?? fieldValue ?? defaultValue ?? false

  return (
    <div>
      <Checkbox
        id={id ?? fieldPath}
        name={field.name}
        label={field.label}
        checked={checked}
        helpText={field.helpText}
        // TODO: Handle indeterminate state
        onCheckedChange={(value) => {
          const next = value === 'indeterminate' ? false : Boolean(value)
          onChange?.(next)
        }}
        error={fieldError != null}
        errorText={fieldError}
      />
    </div>
  )
}
