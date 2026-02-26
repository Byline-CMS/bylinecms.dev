/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo } from 'react'

import type {
  ArrayField as ArrayFieldType,
  BlocksField as BlocksFieldType,
  CompositeField as CompositeFieldType,
  Field,
} from '@byline/core'

import { ArrayField } from '@/ui/fields/array/array-field'
import { BlocksField } from '@/ui/fields/blocks/blocks-field'
import { placeholderForField } from '@/ui/fields/field-helpers'
import { CheckboxField } from '../fields/checkbox/checkbox-field'
import { RichTextField } from '../fields/richtext/richtext-lexical/richtext-field'
import { SelectField } from '../fields/select/select-field'
import { TextField } from '../fields/text/text-field'
import { TextAreaField } from '../fields/text-area/text-area-field'
import { useFieldChangeHandler } from '../fields/use-field-change-handler'
import { DateTimeField } from './datetime/datetime-field'
import { FileField } from './file/file-field'
import { ImageField } from './image/image-field'
import { NumericalField } from './numerical/numerical-field'

// ---------------------------------------------------------------------------
// CompositeFieldRenderer — renders a fixed-order group of child fields.
// No drag-and-drop. No add/remove. Used both as a standalone field type
// and internally by ArrayField / BlocksField when rendering composite items.
// ---------------------------------------------------------------------------

const CompositeFieldRenderer = ({
  field,
  defaultValue,
  path,
}: {
  field: CompositeFieldType
  defaultValue: any
  path: string
}) => {
  // Default value for a composite is an array of single-key objects:
  // [{ rating: 5 }, { comment: '...' }]
  // Normalize sparse arrays (holes from flattening) into a per-field array.
  const normalized = useMemo(() => {
    if (!Array.isArray(defaultValue)) return []
    return (field.fields as Field[]).map((childField) => {
      const found = defaultValue.find(
        (el: any) => el != null && typeof el === 'object' && Object.hasOwn(el, childField.name)
      )
      return found ?? { [childField.name]: placeholderForField(childField) }
    })
  }, [defaultValue, field.fields])

  return (
    <div className="flex flex-col gap-2">
      {field.label && (
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[1rem] font-medium">{field.label}</h3>
          {field.helpText && (
            <p className="text-xs text-muted">{field.helpText}</p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-4">
        {(field.fields as Field[]).map((innerField, idx) => {
          const element = normalized[idx] ?? {}
          return (
            <FieldRenderer
              key={innerField.name}
              field={innerField}
              defaultValue={element[innerField.name]}
              basePath={`${path}[${idx}]`}
              disableSorting={true}
            />
          )
        })}      </div>    </div>
  )
}

// ---------------------------------------------------------------------------
// FieldRenderer — the main field type switch. Delegates to the appropriate
// field widget based on `field.type`.
// ---------------------------------------------------------------------------

interface FieldRendererProps {
  field: Field
  defaultValue?: any
  basePath?: string
  disableSorting?: boolean
  hideLabel?: boolean
  /** Collection path (e.g. `'media'`) forwarded to upload-capable fields. */
  collectionPath?: string
}

export const FieldRenderer = ({
  field,
  defaultValue,
  basePath,
  disableSorting,
  hideLabel,
  collectionPath,
}: FieldRendererProps) => {
  const path = basePath ? `${basePath}.${field.name}` : field.name
  const htmlId = path.replace(/[[\].]/g, '-')

  const handleChange = useFieldChangeHandler(field, path)

  switch (field.type) {
    case 'text':
      console.log(field)
      return (
        <TextField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'textArea':
      return (
        <TextAreaField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'checkbox':
      return (
        <CheckboxField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'select':
      return (
        <SelectField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'richText':
      return (
        <RichTextField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          instanceKey={htmlId}
        />
      )
    case 'datetime':
      return (
        <DateTimeField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'integer':
      return (
        <NumericalField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          id={htmlId}
        />
      )
    case 'file':
      return (
        <FileField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
        />
      )
    case 'image':
      return (
        <ImageField
          field={hideLabel ? { ...field, label: undefined } : field}
          defaultValue={defaultValue}
          onChange={handleChange}
          path={path}
          collectionPath={collectionPath}
        />
      )
    case 'composite':
      // Render a composite as a fixed-order inline field group.
      return (
        <CompositeFieldRenderer
          field={hideLabel ? { ...field, label: undefined } as unknown as CompositeFieldType : field as unknown as CompositeFieldType}
          defaultValue={defaultValue}
          path={path}
        />
      )
    case 'blocks':
      if (!field.fields) return null
      return (
        <BlocksField
          field={field as unknown as BlocksFieldType}
          defaultValue={defaultValue}
          path={path}
        />
      )
    case 'array':
      if (!field.fields) return null
      return (
        <ArrayField
          field={field as unknown as ArrayFieldType}
          defaultValue={defaultValue}
          path={path}
          disableSorting={disableSorting}
        />
      )
    default:
      return null
  }
}
