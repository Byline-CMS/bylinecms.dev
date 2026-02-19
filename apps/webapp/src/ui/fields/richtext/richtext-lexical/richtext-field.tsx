/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RichTextField as FieldType } from '@byline/core'

import { useFieldError, useFieldValue } from '../../form-context'
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
}: Props) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  // const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<any>(fieldPath)
  const incomingValue = value ?? fieldValue
  const incomingDefault = defaultValue

  return (
    <div className={`flex flex-1 h-full`}>
      <div className="flex flex-1 flex-col gap-1">
        <EditorField
          onChange={onChange}
          editorConfig={editorConfig || defaultEditorConfig}
          id={instanceKey ? `${field.name}-${instanceKey}` : field.name}
          name={field.name}
          description={field.helpText}
          readonly={readonly}
          label={field.label}
          required={field.required}
          value={incomingValue}
          defaultValue={incomingDefault}
          // Ensure React fully remounts when instanceKey changes
          key={instanceKey ? `${field.name}-${instanceKey}` : field.name}
        />
        {fieldError && <div className="text-xs text-red-400 px-0.5">{fieldError}</div>}
      </div>
    </div>
  )
}
