/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'

import type { RichTextField as FieldType } from '@byline/core'
import { Label } from '@infonomic/uikit/react'

import { useFieldError, useFieldValue } from '../../form-context'
import { LocaleBadge } from '../../locale-badge'
import { defaultEditorConfig } from './field/config/default'
import { EditorField } from './field/editor-field'

interface Props {
  field: FieldType
  readonly?: boolean
  instanceKey?: string
  value?: any
  defaultValue?: any
  editorConfig?: any
  onChange?: (value: any) => void
  path?: string
  /** When provided, renders a LocaleBadge next to the field label. */
  locale?: string
}

export const RichTextField = ({
  field,
  value,
  defaultValue,
  editorConfig,
  readonly = false,
  instanceKey,
  onChange,
  path,
  locale,
}: Props) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  // const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<any>(fieldPath)
  const incomingValue = value ?? fieldValue
  const incomingDefault = defaultValue

  const fieldId = instanceKey ? `${field.name}-${instanceKey}` : field.name

  // Assemble the label node here (a Byline-level concern) so that the editor
  // component itself stays free of any Byline-specific dependencies.
  const labelNode: React.ReactNode =
    locale && field.label ? (
      <div className="flex items-center">
        <Label
          id={`${fieldId}-label`}
          label={field.label}
          htmlFor={fieldId}
          required={field.required}
        />
        <LocaleBadge locale={locale} />
      </div>
    ) : (
      field.label
    )

  return (
    <div className={`byline-richText ${field.name} flex flex-1 h-full`}>
      <div className="flex flex-1 flex-col gap-1">
        <EditorField
          onChange={onChange}
          editorConfig={editorConfig || defaultEditorConfig}
          id={fieldId}
          name={field.name}
          description={field.helpText}
          readonly={readonly}
          label={labelNode}
          required={field.required}
          value={incomingValue}
          defaultValue={incomingDefault}
          // Ensure React fully remounts when instanceKey changes
          key={fieldId}
        />
        {fieldError && <div className="text-xs text-red-400 px-0.5">{fieldError}</div>}
      </div>
    </div>
  )
}
