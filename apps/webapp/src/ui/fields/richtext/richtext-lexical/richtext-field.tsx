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
