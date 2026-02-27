/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  ArrayField as ArrayFieldType,
  BlocksField as BlocksFieldType,
  Field,
  GroupField as GroupFieldType,
} from '@byline/core'

import { ArrayField } from '@/ui/fields/array/array-field'
import { BlocksField } from '@/ui/fields/blocks/blocks-field'
import { GroupField } from '@/ui/fields/group/group-field'
import { CheckboxField } from '../fields/checkbox/checkbox-field'
import { RichTextField } from '../fields/richtext/richtext-lexical/richtext-field'
import { SelectField } from '../fields/select/select-field'
import { TextField } from '../fields/text/text-field'
import { TextAreaField } from '../fields/text-area/text-area-field'
import { useFieldChangeHandler } from '../fields/use-field-change-handler'
import { DateTimeField } from './datetime/datetime-field'
import { FileField } from './file/file-field'
import { ImageField } from './image/image-field'
import { LocaleBadge } from './locale-badge'
import { NumericalField } from './numerical/numerical-field'

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
  /**
   * The active content locale (e.g. `'en'`, `'fr'`). When provided and
   * `field.localized === true`, a small locale badge is shown so the editor
   * knows they are working on a localised field in the current language.
   */
  contentLocale?: string
}

export const FieldRenderer = ({
  field,
  defaultValue,
  basePath,
  disableSorting,
  hideLabel,
  collectionPath,
  contentLocale,
}: FieldRendererProps) => {
  const path = basePath ? `${basePath}.${field.name}` : field.name
  const htmlId = path.replace(/[[\].]/g, '-')

  const handleChange = useFieldChangeHandler(field, path)

  // When a locale is active and the field is localised, inject a badge into
  // the field label so the editor knows they are editing locale-specific content.
  const isLocalised = (field as any).localized === true

  const badge =
    isLocalised && contentLocale && !hideLabel ? <LocaleBadge locale={contentLocale} /> : null

  /**
   * Render the underlying field widget. If the field is localised, we wrap it
   * so we can append the locale badge after the label.
   */
  const renderField = () => {
    switch (field.type) {
      case 'text':
        return (
          <TextField
            field={hideLabel ? { ...field, label: undefined } : field}
            defaultValue={defaultValue}
            onChange={handleChange}
            path={path}
            id={htmlId}
            locale={isLocalised ? contentLocale : undefined}
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
            locale={isLocalised ? contentLocale : undefined}
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
            locale={isLocalised ? contentLocale : undefined}
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
      case 'group':
        // Render a group field as a fixed-order inline field group.
        return (
          <GroupField
            field={
              hideLabel
                ? ({ ...field, label: undefined } as unknown as GroupFieldType)
                : (field as unknown as GroupFieldType)
            }
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

  // text and textArea render the badge inside their own Label row;
  // the outer wrapper is only needed for other field types.
  const selfBadge = field.type === 'text' || field.type === 'textArea' || field.type === 'richText'

  if (badge && !selfBadge) {
    return (
      <div className="localized-field relative">
        {renderField()}
        <span className="locale-badge absolute top-0 right-0 leading-none">{badge}</span>
      </div>
    )
  }

  return renderField()
}
