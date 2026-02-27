/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback } from 'react'

import type { TextAreaField as FieldType } from '@byline/core'
import { Label, TextArea } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue, useIsDirty } from '../../fields/form-context'
import { LocaleBadge } from '../locale-badge'

export const TextAreaField = ({
  field,
  value,
  defaultValue,
  onChange,
  id,
  path,
  locale,
}: {
  field: FieldType
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  id?: string
  path?: string
  /** When provided, renders a LocaleBadge next to the field label. */
  locale?: string
}) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const _isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<string | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? ''

  const handleChange = useCallback(
    (value: string) => {
      if (onChange) {
        onChange(value)
      }
    },
    [onChange]
  )

  // When a locale is active, render a custom Label+badge and suppress the
  // TextArea's own label so the locale indicator appears in the label row.
  const showBadge = !!locale && !!field.label

  return (
    <div className={`byline-textArea ${field.name}`}>
      {showBadge && (
        <div className="flex items-center">
          <Label id={`${id ?? fieldPath}-label`} htmlFor={id ?? fieldPath} label={field.label!} required={field.required} />
          <LocaleBadge locale={locale} />
        </div>
      )}
      <TextArea
        id={id ?? fieldPath}
        name={field.name}
        label={showBadge ? undefined : field.label}
        required={field.required}
        helpText={field.helpText}
        value={incomingValue}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange(e.target.value)}
        error={fieldError != null}
        errorText={fieldError}
        // className={isDirty ? 'border-blue-300' : ''}
        rows={4}
      />
    </div>
  )
}
