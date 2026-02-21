/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useRef } from 'react'

import type { TextField as FieldType } from '@byline/core'
import { Input } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue } from '../../fields/form-context'

export const TextField = ({
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
  // const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<string | undefined>(fieldPath)
  const dispatchFieldUpdateTask = useRef<number>(undefined)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? ''

  const handleChange = useCallback(
    (value: string) => {
      const updateFieldValue = (val: string) => {
        if (onChange) {
          onChange(val)
        }
      }

      if (typeof window.requestIdleCallback === 'function') {
        if (typeof window.cancelIdleCallback === 'function' && dispatchFieldUpdateTask.current) {
          cancelIdleCallback(dispatchFieldUpdateTask.current)
        }
        dispatchFieldUpdateTask.current = requestIdleCallback(() => updateFieldValue(value), {
          timeout: 500,
        })
      } else {
        updateFieldValue(value)
      }
    },
    [onChange]
  )

  return (
    <div>
      <Input
        id={id ?? fieldPath}
        name={field.name}
        label={field.label}
        required={field.required}
        helpText={field.helpText}
        value={incomingValue}
        onChange={(e) => handleChange(e.target.value)}
        error={fieldError != null}
        errorText={fieldError}
      // className={isDirty ? 'border-yellow-300' : ''}
      />
    </div>
  )
}
